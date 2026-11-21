//go:build !windows

package hold

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

// openInput is the input pipe, read-write, so it never reads as ended while no daemon has it
// open: it comes and goes.
func openInput(dir string) (io.ReadCloser, error) {
	pipe := filepath.Join(dir, FileIn)
	if err := unix.Mkfifo(pipe, 0o600); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	return os.OpenFile(pipe, os.O_RDWR, 0)
}

// groupAttr starts the agent in a process group of its own.
func groupAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{Setpgid: true} }

func notifyStop(sigs chan<- os.Signal) {
	signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT)
	signal.Ignore(syscall.SIGHUP, syscall.SIGPIPE)
}

// group is the agent's process group.
type group int

func newGroup(pid int, _ func(string, ...any)) group { return group(pid) }
func (g group) term()                                { _ = unix.Kill(-int(g), unix.SIGTERM) }
func (g group) kill()                                { _ = unix.Kill(-int(g), unix.SIGKILL) }
func (g group) close()                               {}

func exitOf(ps *os.ProcessState) Exit {
	ws, ok := ps.Sys().(syscall.WaitStatus)
	if ok && ws.Signaled() {
		name := SignalName(ws.Signal())
		return Exit{From: "agent", Signal: &name}
	}
	return Exit{From: "agent", Code: ptr(ps.ExitCode())}
}

// SignalName is the signal's name as systemd writes it: KILL, TERM.
func SignalName(s syscall.Signal) string {
	if n := unix.SignalName(s); n != "" {
		return strings.TrimPrefix(n, "SIG")
	}
	return strconv.Itoa(int(s))
}

// lookPath finds name as exec.LookPath would, but on the agent's PATH, not the holder's.
func lookPath(name string, env []string) (string, error) {
	if strings.Contains(name, "/") {
		if _, err := os.Stat(name); err != nil {
			return "", err
		}
		return name, nil
	}
	path := ""
	for _, kv := range env {
		if v, ok := strings.CutPrefix(kv, "PATH="); ok {
			path = v
		}
	}
	for _, d := range filepath.SplitList(path) {
		if d == "" {
			continue
		}
		p := filepath.Join(d, name)
		if st, err := os.Stat(p); err == nil && !st.IsDir() && st.Mode()&0o111 != 0 {
			return p, nil
		}
	}
	return "", fmt.Errorf("%s not found on PATH %q", name, path)
}

// prepareInput makes the input pipe before the holder starts.
func prepareInput(dir string) error {
	if err := unix.Mkfifo(filepath.Join(dir, FileIn), 0o600); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	return nil
}

// openWriter opens the pipe for writing without waiting for a reader: none (ENXIO) is ErrNoHolder.
func openWriter(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_WRONLY|syscall.O_NONBLOCK, 0)
	if errors.Is(err, syscall.ENXIO) || errors.Is(err, os.ErrNotExist) {
		return nil, ErrNoHolder
	}
	return f, err
}

// noReader: a write found no holder reading.
func noReader(err error) bool { return errors.Is(err, syscall.EPIPE) }
