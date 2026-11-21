//go:build !windows

package discover

import (
	"os"
	"testing"

	"golang.org/x/sys/unix"
)

func testLock(t *testing.T, f *os.File) {
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX); err != nil {
		t.Fatal(err)
	}
}

func testUnlock(f *os.File) { _ = unix.Flock(int(f.Fd()), unix.LOCK_UN) }
