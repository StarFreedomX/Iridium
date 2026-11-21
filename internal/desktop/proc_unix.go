//go:build !windows

package desktop

import (
	"os"
	"os/exec"
	"syscall"
)

// terminate asks cmd to end (SIGTERM): this computer's Iridium closes and its holders keep running.
func terminate(cmd *exec.Cmd) { _ = cmd.Process.Signal(syscall.SIGTERM) }

// reexec runs self in place of this process, with the same arguments.
func reexec(self string) {
	_ = syscall.Exec(self, os.Args, os.Environ())
}
