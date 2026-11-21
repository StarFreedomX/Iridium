// Package desktop is Iridium's desktop app (docs/app.md), part of the one binary: a window on an
// Iridium's page (at first the one on this computer, which it starts), a tray icon, and this
// computer joined to the other Iridiums in its list, as ir-computer joins (internal/join).
// With no window (iridium serve --join), RunJoins runs the joins alone.
package desktop

import (
	"os"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

const usage = "usage: iridium --join <address> [--name <name>] [--roots <dir>,...] [--no-shell] [--agents <agent>,...]\n"

// HandleUpdateHelper: started by an update to swap the program for the new one, it does that and
// exits. First thing in main.
func HandleUpdateHelper() { updater.HandleHelperMode() }

// Main is the window, with the tray; it returns when the app quits.
func Main(o Options) int {
	hideConsole()
	return gui(o)
}

// CanShow says whether a window can be shown here: macOS and Windows always, elsewhere a display.
// iridium with no arguments is the app where it can be, else its usage.
func CanShow() bool {
	switch runtime.GOOS {
	case "darwin", "windows":
		return true
	}
	return os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != ""
}
