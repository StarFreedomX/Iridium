//go:build windows

package desktop

import (
	"os"
	"os/exec"
)

// terminate ends cmd: Windows has no polite stop for another process's console; the holders run
// apart and keep running.
func terminate(cmd *exec.Cmd) { _ = cmd.Process.Kill() }

// reexec starts self again apart, with the same arguments, and ends this process (Windows has no
// exec): the logon task sees it end; the new one runs on.
func reexec(self string) {
	cmd := exec.Command(self, os.Args[1:]...)
	detach(cmd)
	if cmd.Start() == nil {
		os.Exit(0)
	}
}
