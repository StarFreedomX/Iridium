//go:build windows

package discover

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

// ownerOf: /proc is never read here.
func ownerOf(os.FileInfo) int { return -1 }

// locked: another process holds a lock on path (dsh's session.lock, Codex's writer lock), or has
// it open for itself alone. Tried and let go at once; a file that is not there is no lock.
func locked(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return errors.Is(err, windows.ERROR_SHARING_VIOLATION)
	}
	defer f.Close()
	ol := new(windows.Overlapped)
	err = windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, ol)
	if errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
		return true
	}
	if err == nil {
		_ = windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, ol)
	}
	return false
}
