//go:build windows

package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// Detached on Windows, as detached.go elsewhere: each holder under a supervisor of its own,
// `<Argv[0]> hold --unit <file>`, which starts the supervisor proper away from the daemon (a
// console of its own, hidden; out of the daemon's job when that allows it) and exits, so a
// daemon restarting or updating leaves it and its holder running, and a new daemon finds them by
// their files in Dir. The supervisor keeps the holder and all it starts in a job named after the
// unit: a stop asks the holder to end (AskStop: there is no SIGTERM), and once StopTimeout passes
// ends the job; once the holder ends it ends what is left and runs StopPost.
//
// Dir holds, for a unit name: name.json (the unit), name.lock (locked while its supervisor runs:
// the unit exists exactly then), name.pid ("<supervisor> <holder>") and name.log.
type Detached struct {
	Dir string
}

const (
	unitStart = "--unit"
	unitRun   = "--unit-run"
)

type unitFile struct {
	Name          string   `json:"name"`
	Argv          []string `json:"argv"`
	StopPost      []string `json:"stopPost,omitempty"`
	StopTimeoutMS int64    `json:"stopTimeoutMs"`
}

// CREATE_NO_WINDOW: a console of its own that is never shown, which the holder and the agents
// share (no window pops up for them, and Ctrl+Break reaches their groups).
const createNoWindow = 0x08000000

func (d *Detached) path(name, ext string) string { return filepath.Join(d.Dir, name+ext) }

func validName(name string) error {
	if name == "" || strings.ContainsAny(name, `/\:*?"<>|`+"\x00") || name[0] == '.' {
		return fmt.Errorf("bad unit name %q", name)
	}
	return nil
}

func (d *Detached) Start(ctx context.Context, u Unit) error {
	if err := validName(u.Name); err != nil {
		return err
	}
	if len(u.Argv) == 0 || !filepath.IsAbs(u.Argv[0]) {
		return errors.New("a unit needs an absolute path first")
	}
	if err := os.MkdirAll(d.Dir, 0o700); err != nil {
		return err
	}
	if st, err := d.State(ctx, u.Name); err != nil {
		return err
	} else if st.Exists {
		return fmt.Errorf("unit %s exists", u.Name)
	}
	timeout := u.StopTimeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	b, err := json.Marshal(unitFile{Name: u.Name, Argv: u.Argv, StopPost: u.StopPost, StopTimeoutMS: timeout.Milliseconds()})
	if err != nil {
		return err
	}
	file := d.path(u.Name, ".json")
	if err := writeAtomic(file, b); err != nil {
		return err
	}
	// The supervisor says "ok" on its stdout once the holder runs, or what went wrong, and
	// closes it. Anonymous pipes have no deadlines here: the read waits in a goroutine.
	r, w, err := os.Pipe()
	if err != nil {
		return err
	}
	defer r.Close()
	cmd := exec.Command(u.Argv[0], "hold", unitStart, file)
	cmd.Stdout, cmd.Stderr = w, w
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNoWindow, HideWindow: true}
	err = cmd.Start()
	w.Close()
	if err != nil {
		return err
	}
	type read struct {
		out []byte
		err error
	}
	got := make(chan read, 1)
	go func() {
		out, err := io.ReadAll(io.LimitReader(r, 64<<10))
		got <- read{out, err}
	}()
	deadline := 10 * time.Second
	if dl, ok := ctx.Deadline(); ok && time.Until(dl) < deadline {
		deadline = time.Until(dl)
	}
	var res read
	select {
	case res = <-got:
	case <-time.After(deadline):
		res.err = errors.New("no answer from its supervisor")
	}
	werr := cmd.Wait()
	said := strings.TrimSpace(string(res.out))
	switch {
	case said == "ok":
		return nil
	case said != "":
		return fmt.Errorf("unit %s: %s", u.Name, said)
	case res.err != nil:
		return fmt.Errorf("unit %s: %w", u.Name, res.err)
	case werr != nil:
		return fmt.Errorf("unit %s: %w", u.Name, werr)
	}
	return fmt.Errorf("unit %s did not start", u.Name)
}

// locked says whether a process holds path's lock.
func locked(path string) (bool, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer f.Close()
	ol := new(windows.Overlapped)
	err = windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, ol)
	if err == nil {
		_ = windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, ol)
		return false, nil
	}
	if errors.Is(err, windows.ERROR_LOCK_VIOLATION) || errors.Is(err, windows.ERROR_IO_PENDING) {
		return true, nil
	}
	return false, err
}

// pids is the supervisor's and the holder's pid while the unit exists; 0, 0 if it does not.
func (d *Detached) pids(name string) (super, main int, err error) {
	if err := validName(name); err != nil {
		return 0, 0, err
	}
	on, err := locked(d.path(name, ".lock"))
	if err != nil || !on {
		return 0, 0, err
	}
	for i := 0; ; i++ {
		b, err := os.ReadFile(d.path(name, ".pid"))
		if err == nil {
			if n, _ := fmt.Sscan(string(b), &super, &main); n == 2 {
				return super, main, nil
			}
		}
		if i == 50 {
			return 0, 0, fmt.Errorf("unit %s has no pid file", name)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (d *Detached) Stop(_ context.Context, name string) error {
	super, _, err := d.pids(name)
	if err != nil || super == 0 {
		return err
	}
	return AskStop(super)
}

// Kill: TERM (or INT) is a stop request to the holder (main) or the supervisor; KILL ends the
// holder (main) or every process of the unit's job, the supervisor kept to run StopPost.
func (d *Detached) Kill(_ context.Context, name, sig string, main bool) error {
	super, holder, err := d.pids(name)
	if err != nil {
		return err
	}
	if super == 0 {
		return errors.New("no unit " + name)
	}
	switch strings.ToUpper(sig) {
	case "TERM", "INT":
		if main {
			return AskStop(holder)
		}
		return AskStop(super)
	case "KILL":
		if main {
			return TerminatePID(holder, 1)
		}
		job, err := OpenJob(name)
		if err != nil {
			return fmt.Errorf("unit %s: its job: %w", name, err)
		}
		defer job.Close()
		return job.Kill(1)
	}
	return errors.New("no signal " + sig)
}

func (d *Detached) State(_ context.Context, name string) (State, error) {
	super, main, err := d.pids(name)
	if err != nil || super == 0 {
		return State{}, err
	}
	return State{Exists: true, Active: "active", MainPID: main}, nil
}

func (d *Detached) List(ctx context.Context, prefix string) ([]string, error) {
	locks, err := filepath.Glob(filepath.Join(d.Dir, "*.lock"))
	if err != nil {
		return nil, err
	}
	var names []string
	for _, l := range locks {
		n := strings.TrimSuffix(filepath.Base(l), ".lock")
		if !strings.HasPrefix(n, prefix) {
			continue
		}
		if st, err := d.State(ctx, n); err == nil && st.Exists {
			names = append(names, n)
		}
	}
	return names, nil
}

// Supervise is `hold --unit <file>` and `hold --unit-run <file>`, the two stages of a Detached
// unit's supervisor; ok is false for other arguments.
func Supervise(args []string) (code int, ok bool) {
	if len(args) != 2 {
		return 0, false
	}
	switch args[0] {
	case unitStart:
		return superStart(args[1]), true
	case unitRun:
		return superRun(args[1]), true
	}
	return 0, false
}

// superStart starts the supervisor proper on its own (its stdout the pipe Start reads) and exits,
// so Start, which waits for this process, does not wait for the unit.
func superStart(file string) int {
	exe, err := os.Executable()
	if err != nil {
		fmt.Println(err)
		return 1
	}
	logPath := strings.TrimSuffix(file, ".json") + ".log"
	log, err := os.OpenFile(logPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		fmt.Println(err)
		return 1
	}
	defer log.Close()
	start := func(flags uint32) error {
		cmd := exec.Command(exe, "hold", unitRun, file)
		cmd.Stdout, cmd.Stderr = os.Stdout, log
		cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: flags, HideWindow: true}
		return cmd.Start()
	}
	// Out of the daemon's job, so ending the daemon's (a service manager's) leaves the unit; a
	// job that allows no breakaway refuses, and the unit stays in it.
	flags := uint32(createNoWindow | syscall.CREATE_NEW_PROCESS_GROUP)
	if err := start(flags | windows.CREATE_BREAKAWAY_FROM_JOB); err != nil {
		if err := start(flags); err != nil {
			fmt.Println(err)
			return 1
		}
	}
	return 0
}

// superRun is the supervisor: it holds the unit's lock while it runs.
func superRun(file string) int {
	base := strings.TrimSuffix(file, ".json")
	fail := func(err error) int {
		fmt.Println(err)
		return 1
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return fail(err)
	}
	var u unitFile
	if err := json.Unmarshal(b, &u); err != nil {
		return fail(err)
	}
	if len(u.Argv) == 0 {
		return fail(errors.New("no argv"))
	}
	unlock, err := TryLock(base + ".lock")
	if err != nil {
		return fail(fmt.Errorf("unit %s exists", u.Name))
	}
	job, err := NewJob(u.Name, false)
	if err != nil {
		unlock()
		return fail(err)
	}
	defer job.Close()
	sigs := make(chan os.Signal, 1)
	NotifyStop(sigs)
	holder := exec.Command(u.Argv[0], u.Argv[1:]...)
	holder.Stderr = os.Stderr
	holder.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
	if err := holder.Start(); err != nil {
		unlock()
		os.Remove(base + ".lock")
		return fail(err)
	}
	if err := job.Add(holder.Process.Pid); err != nil {
		fmt.Fprintf(os.Stderr, "iridium unit %s: its job: %v\n", u.Name, err)
	}
	if err := writeAtomic(base+".pid", []byte(fmt.Sprintf("%d %d\n", os.Getpid(), holder.Process.Pid))); err != nil {
		fmt.Fprintf(os.Stderr, "iridium unit %s: %v\n", u.Name, err)
	}
	fmt.Println("ok")
	os.Stdout.Close()

	done := make(chan struct{})
	go func() {
		_ = holder.Wait()
		close(done)
	}()
	timeout := time.Duration(u.StopTimeoutMS) * time.Millisecond
	var kill <-chan time.Time
	killed := false
	for running := true; running; {
		select {
		case <-done:
			running = false
		case <-sigs:
			if kill == nil {
				_ = AskStop(holder.Process.Pid)
				kill = time.After(timeout)
			}
		case <-kill:
			killed = true
			_ = job.Kill(1)
		}
	}
	// What the holder left: a moment to end, then ended. Nothing here takes a polite request.
	if job.Active() > 0 {
		for end := time.Now().Add(min(timeout, time.Second)); time.Now().Before(end) && job.Active() > 0; {
			time.Sleep(50 * time.Millisecond)
		}
		_ = job.Kill(1)
	}
	if len(u.StopPost) > 0 {
		code, status := "exited", strconv.Itoa(holder.ProcessState.ExitCode())
		if killed {
			code, status = "killed", "KILL"
		}
		post := exec.Command(u.StopPost[0], u.StopPost[1:]...)
		post.Env = append(os.Environ(), "EXIT_CODE="+code, "EXIT_STATUS="+status)
		post.Stdout, post.Stderr = os.Stderr, os.Stderr
		if err := post.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "iridium unit %s: stop-post: %v\n", u.Name, err)
		}
	}
	os.Remove(base + ".pid")
	os.Remove(file)
	if st, err := os.Stat(base + ".log"); err == nil && st.Size() == 0 {
		os.Remove(base + ".log")
	}
	// A file open here cannot be removed: the lock goes first.
	unlock()
	os.Remove(base + ".lock")
	return 0
}

func writeAtomic(path string, b []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
