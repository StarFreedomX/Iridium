// Command ir-app is Iridium's desktop client (docs/app.md): a window on an Iridium's page and this
// computer joined to it, as ir-computer joins (internal/join), in one program. Its own releases
// and its own update (update.go), apart from the Iridium's. "headless" runs the joins alone, for
// a computer with no screen. Started by the name ir it is the CLI, for the agents it starts.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/kumoSleeping/iridium/internal/version"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

const usage = `usage: ir-app                      the window, and this computer joined to its Iridiums
       ir-app headless [options] [address…]
                                   the joins alone (no screen): the addresses given, else the app's
  --name      this computer's name there (default: the host name, 12 characters at most)
  --roots     the only directories files are read and written under (default: all of them)
  --no-shell  no command lines run here: only the agents start
       ir-app version
`

func main() {
	// Started by an update to swap the program for the new one: does it and exits.
	updater.HandleHelperMode()
	if strings.TrimSuffix(strings.ToLower(filepath.Base(os.Args[0])), ".exe") == "ir" {
		os.Exit(irMain(os.Args[1:]))
	}
	args := os.Args[1:]
	if len(args) > 0 {
		switch args[0] {
		case "version", "--version":
			fmt.Println("ir-app", version.Version)
			return
		case "help", "-h", "--help":
			fmt.Print(usage)
			return
		case "headless":
			os.Exit(headless(args[1:]))
		}
	}
	os.Exit(gui())
}
