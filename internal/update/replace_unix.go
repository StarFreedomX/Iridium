//go:build !windows

package update

import "os"

const (
	binName = "iridium" // the binary in a release's archive
	exeExt  = ""
)

// replace puts bin in exe's place.
func replace(bin, exe string) error { return os.Rename(bin, exe) }

// link is a hard link.
func link(from, to string) error { return os.Link(from, to) }

func dropReplaced(string) {}
