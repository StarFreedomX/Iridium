//go:build windows

package discover

import (
	"os"
	"testing"

	"golang.org/x/sys/windows"
)

func testLock(t *testing.T, f *os.File) {
	if err := windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, new(windows.Overlapped)); err != nil {
		t.Fatal(err)
	}
}

func testUnlock(f *os.File) {
	_ = windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, new(windows.Overlapped))
}
