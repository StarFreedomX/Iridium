//go:build !windows

package join

import (
	"fmt"
	"os"
	"syscall"
)

// reexec runs exe with args in place of this process (the same terminal, its lock let go).
func reexec(exe string, args []string) int {
	err := syscall.Exec(exe, append([]string{exe}, args...), os.Environ())
	fmt.Fprintf(os.Stderr, "restart: %v\n", err)
	return 1
}
