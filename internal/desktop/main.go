// Package desktop is Iridium's desktop app (docs/app.md), part of the one binary: a window on an
// Iridium's page (at first the one on this computer, which it starts), a tray icon, and this
// computer joined to the other Iridiums in its list, as ir-computer joins (internal/join).
// The joins and this computer's Iridium run in the runtime (runtime.go), the window only shows it;
// with no window (ir serve --join), RunJoins runs the joins alone.
package desktop

import (
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"time"
)

const usage = "usage: iridium --join <address> [--name <name>] [--roots <dir>,...] [--no-shell] [--agents <agent>,...]\n"

// Main is the window, with the tray; it returns when the app quits.
func Main(o Options) int {
	hideConsole()
	// Started again by the one before it (restartApp): that one ends first.
	if pid, err := strconv.Atoi(os.Getenv("IRIDIUM_WAIT_PID")); err == nil {
		os.Unsetenv("IRIDIUM_WAIT_PID")
		for end := time.Now().Add(10 * time.Second); alive(pid) && time.Now().Before(end); {
			time.Sleep(100 * time.Millisecond)
		}
	}
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

// Detach starts cmd apart from this process: quitting it leaves cmd running.
func Detach(cmd *exec.Cmd) {
	detach(cmd)
	quiet(cmd)
}
