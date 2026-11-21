// Package desktop is Iridium's desktop app (docs/app.md), part of the one binary: a window on an
// Iridium's page (at first the one on this computer, which it starts), a tray icon, and this
// computer joined to the other Iridiums in its list, as ir-computer joins (internal/join).
// "headless" runs the joins alone, for a computer with no screen.
package desktop

import (
	"os"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// Usage is the app's part of iridium's usage.
const Usage = `  iridium [app]                    the desktop app: a window on this computer's Iridium (started
                                   if it is not running) or another one, and a tray icon
  iridium headless [--name <name>] [--roots <dir>,...] [--no-shell] [address...]
                                   this computer joined to the app's Iridiums, no window: the
                                   addresses given, else the app's list
`

const usage = "usage:\n" + Usage

// HandleUpdateHelper: started by an update to swap the program for the new one, it does that and
// exits. First thing in main.
func HandleUpdateHelper() { updater.HandleHelperMode() }

// Main is the window, with the tray; it returns when the app quits.
func Main() int { return gui() }

// Headless is `iridium headless`.
func Headless(args []string) int { return headless(args) }

// CanShow says whether a window can be shown here: macOS and Windows always, elsewhere a display.
// iridium with no arguments is the app where it can be, else its usage.
func CanShow() bool {
	switch runtime.GOOS {
	case "darwin", "windows":
		return true
	}
	return os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != ""
}
