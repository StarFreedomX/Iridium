//go:build !windows

package discover

import (
	"errors"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

// ownerOf is the uid owning a /proc entry.
func ownerOf(fi os.FileInfo) int {
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return int(st.Uid)
	}
	return 0
}

// locked: another process holds the flock on path (dsh's session.lock, Codex's writer lock).
// Tried and let go at once; a file that is not there is no lock.
func locked(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	err = unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
	if errors.Is(err, unix.EWOULDBLOCK) {
		return true
	}
	if err == nil {
		_ = unix.Flock(int(f.Fd()), unix.LOCK_UN)
	}
	return false
}
