//go:build !windows

package update

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

const (
	binName = "iridium" // the binary in a release's archive
	exeExt  = ""
)

// replace puts bin in exe's place.
func replace(bin, exe string) error { return os.Rename(bin, exe) }

// link is a hard link.
func link(from, to string) error { return os.Link(from, to) }

func dropReplaced(string) {}

// resign signs the macOS app exe is in again, whole (ad hoc, as the release did): a binary changed
// inside a signed bundle leaves its signature broken, and macOS then calls the app damaged.
// Outside an app, nothing.
func resign(exe string) error {
	i := strings.Index(exe, ".app/Contents/MacOS/")
	if runtime.GOOS != "darwin" || i < 0 {
		return nil
	}
	out, err := exec.Command("codesign", "--force", "--deep", "-s", "-", "--identifier", "ltd.kumo.iridium.app", exe[:i+len(".app")]).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
