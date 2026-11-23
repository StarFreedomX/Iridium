//go:build windows

package update

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const (
	binName = "iridium.exe" // the binary in a release's archive
	// A program without .exe is not started here: a downloaded one is named so to be run.
	exeExt = ".exe"
)

// replaced names the running binary moved aside: Windows lets a running program be renamed,
// not replaced or removed. Its holders may still run it; it goes at a later start (dropReplaced).
func replaced(exe string) string {
	return exe + ".old." + strconv.FormatInt(time.Now().UnixNano(), 10)
}

// replace moves exe aside and puts bin in its place; a failure puts exe back.
func replace(bin, exe string) error {
	old := replaced(exe)
	if err := os.Rename(exe, old); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(bin, exe); err != nil {
		_ = os.Rename(old, exe)
		return err
	}
	return nil
}

// link is a copy: a link to the running program would be a name of it that cannot go.
func link(from, to string) error { return copyFile(from, to) }

// dropReplaced removes the binaries replace moved aside that nothing runs any more.
func dropReplaced(exe string) {
	old, _ := filepath.Glob(exe + ".old.*")
	for _, p := range old {
		os.Remove(p)
	}
}

// resign: Windows has no app to sign again.
func resign(string, string) error { return nil }
