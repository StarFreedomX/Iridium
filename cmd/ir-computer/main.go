// Command ir-computer makes this computer run agents for an Iridium while it runs in a terminal
// (docs/exec.md "ir-computer"): ir join as a program of its own, fetched and started by the line
// the Iridium gives (<address>/join). The agents it starts get it as their ir (by that name it is
// the CLI; not on Windows).
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/kumoSleeping/iridium/internal/join"
	"github.com/kumoSleeping/iridium/internal/version"
)

const usage = `usage: ir-computer <address> [--name name] [--roots dir,…] [--shell]
  Run agents for an Iridium while this runs: pair once (a code to match on its page), then stay
  connected till it is stopped (Ctrl-C, the window closed), the agents it started with it.
  --name      this computer's name there (default: the host name, 12 characters at most)
  --roots     the directories it may read and write files under (default: the home directory)
  --shell     command lines from that Iridium run here: a person's on its page and its agents' (ir sh);
              without it only the agents start here
`

func main() {
	if strings.TrimSuffix(strings.ToLower(filepath.Base(os.Args[0])), ".exe") == "ir" {
		os.Exit(irMain(os.Args[1:]))
	}
	if len(os.Args) == 2 {
		switch os.Args[1] {
		case "version", "--version":
			fmt.Println("ir-computer", version.Version)
			return
		case "help", "-h", "--help":
			fmt.Print(usage)
			return
		}
	}
	p := join.Program{Name: "ir-computer", Self: "ir-computer", Usage: usage, Update: true}
	os.Exit(p.Main(os.Args[1:], os.Stdout, os.Stderr))
}
