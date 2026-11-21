//go:build !windows

package desktop

import (
	"os/exec"
	"syscall"
)

// detach starts cmd in a session of its own: the app quitting leaves it running.
func detach(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }

// quiet: no console window for cmd (Windows only).
func quiet(*exec.Cmd) {}
