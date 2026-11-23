//go:build !windows

package update

import (
	"os"

	"github.com/kumoSleeping/iridium/internal/macapp"
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

// resign writes the macOS app exe is in for version and signs it again (macapp.Refresh): its
// Info.plist and icon those of the new release, not those it was installed with.
func resign(exe, version string) error { return macapp.Refresh(exe, version) }
