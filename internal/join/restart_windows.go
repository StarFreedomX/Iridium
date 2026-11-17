package join

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
)

// reexec runs exe with args in this console till it ends: Windows has no exec.
func reexec(exe string, args []string) int {
	cmd := exec.Command(exe, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	err := cmd.Run()
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "restart: %v\n", err)
		return 1
	}
	return 0
}
