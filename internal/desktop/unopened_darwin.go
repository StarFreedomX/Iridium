package desktop

import (
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

// unopened: path came from a download macOS has not let open yet (its quarantine mark without the
// user's approval, flag 0x40). Run, it brings up Gatekeeper's warning and is ended at once: under
// launchd, again every few seconds (kumo, 2026-11-22: a new Iridium.app unpacked over the old,
// the warning came back and back).
func unopened(path string) bool {
	buf := make([]byte, 256)
	n, err := unix.Getxattr(path, "com.apple.quarantine", buf)
	if err != nil || n <= 0 {
		return false
	}
	flags, _, _ := strings.Cut(string(buf[:n]), ";")
	f, err := strconv.ParseUint(flags, 16, 32)
	return err == nil && f&0x40 == 0
}
