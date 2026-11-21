//go:build windows

package platform

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

// Direct runs holders as children of this process, each in a job of its own, and runs StopPost
// as systemd would when one ends. For tests: a holder ends with the daemon (its job is closed with
// it), and a restarted daemon cannot find it.
type Direct struct {
	mu    sync.Mutex
	units map[string]*direct
}

type direct struct {
	cmd *exec.Cmd
	job *Job
}

func (d *Direct) Start(ctx context.Context, u Unit) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.units == nil {
		d.units = map[string]*direct{}
	}
	if _, ok := d.units[u.Name]; ok {
		return fmt.Errorf("unit %s exists", u.Name)
	}
	job, err := NewJob("", true)
	if err != nil {
		return err
	}
	cmd := exec.Command(u.Argv[0], u.Argv[1:]...)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
	if err := cmd.Start(); err != nil {
		job.Close()
		return err
	}
	_ = job.Add(cmd.Process.Pid)
	x := &direct{cmd: cmd, job: job}
	d.units[u.Name] = x
	go func() {
		_ = cmd.Wait()
		if len(u.StopPost) > 0 {
			post := exec.Command(u.StopPost[0], u.StopPost[1:]...)
			post.Env = append(os.Environ(), "EXIT_CODE=exited", "EXIT_STATUS="+strconv.Itoa(cmd.ProcessState.ExitCode()))
			_ = post.Run()
		}
		d.mu.Lock()
		delete(d.units, u.Name)
		d.mu.Unlock()
		job.Close()
	}()
	return nil
}

func (d *Direct) Stop(ctx context.Context, name string) error {
	return d.Kill(ctx, name, "TERM", true)
}

// Kill: TERM is a stop request (AskStop) to the holder, which holders take; KILL ends the holder
// (main) or its whole job.
func (d *Direct) Kill(_ context.Context, name, sig string, main bool) error {
	d.mu.Lock()
	x := d.units[name]
	d.mu.Unlock()
	if x == nil {
		return errors.New("no unit " + name)
	}
	switch strings.ToUpper(sig) {
	case "TERM", "INT":
		return AskStop(x.cmd.Process.Pid)
	case "KILL":
		if main {
			return x.cmd.Process.Kill()
		}
		return x.job.Kill(1)
	}
	return errors.New("no signal " + sig)
}

func (d *Direct) State(_ context.Context, name string) (State, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	x := d.units[name]
	if x == nil {
		return State{}, nil
	}
	return State{Exists: true, Active: "active", MainPID: x.cmd.Process.Pid}, nil
}

func (d *Direct) List(_ context.Context, prefix string) ([]string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	var names []string
	for n := range d.units {
		if strings.HasPrefix(n, prefix) {
			names = append(names, n)
		}
	}
	return names, nil
}
