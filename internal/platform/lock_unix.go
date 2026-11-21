//go:build !windows

package platform

import (
	"os"

	"golang.org/x/sys/unix"
)

// TryLock takes the file's lock for as long as the process runs (or till unlock), or fails at once
// if another process has it.
func TryLock(path string) (unlock func(), err error) {
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		return nil, err
	}
	return func() { f.Close() }, nil
}
