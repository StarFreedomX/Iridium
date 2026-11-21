//go:build !windows

package desktop

import "syscall"

// alive: does process pid run (or run as another user)?
func alive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}
