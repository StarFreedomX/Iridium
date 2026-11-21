package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/kumoSleeping/iridium/internal/config"
	"github.com/kumoSleeping/iridium/internal/desktop"
)

// runFlags are iridium's options (usage): everything is on unless taken off; joins are added.
type runFlags struct {
	config   string
	noServer bool
	joins    multi
	name     string
	roots    string
	noShell  bool
	agents   string
}

type multi []string

func (m *multi) String() string     { return strings.Join(*m, " ") }
func (m *multi) Set(v string) error { *m = append(*m, v); return nil }

func (f *runFlags) register(fs *flag.FlagSet) {
	fs.StringVar(&f.config, "config", config.DefaultPath(), "this computer's Iridium's config file")
	fs.BoolVar(&f.noServer, "no-server", false, "no Iridium of this computer's own")
	fs.Var(&f.joins, "join", "join this Iridium too (repeatable)")
	fs.StringVar(&f.name, "name", "", "this computer's name there")
	fs.StringVar(&f.roots, "roots", "", "the only folders they may use, comma-separated")
	fs.BoolVar(&f.noShell, "no-shell", false, "no command lines from them")
	fs.StringVar(&f.agents, "agents", "", "the only agents they may start, comma-separated")
}

// serveArgs are the options again, as serve's arguments in a service (install): the config file
// apart (the service writes it itself).
func (f *runFlags) serveArgs() []string {
	var a []string
	if f.noServer {
		a = append(a, "--no-server")
	}
	for _, j := range f.joins {
		a = append(a, "--join", j)
	}
	for _, kv := range [][2]string{{"--name", f.name}, {"--roots", f.roots}, {"--agents", f.agents}} {
		if kv[1] != "" {
			a = append(a, kv[0], kv[1])
		}
	}
	if f.noShell {
		a = append(a, "--no-shell")
	}
	return a
}

func (f *runFlags) terms() (desktop.Terms, error) {
	return desktop.ParseTerms(f.joins, f.name, f.roots, f.noShell, f.agents)
}

// run is iridium with its options: the window where window (and it is not taken away), else
// this computer's Iridium in this process (unless --no-server) and the joins beside it.
func run(args []string, window bool) int {
	var f runFlags
	fs := flag.NewFlagSet("iridium", flag.ContinueOnError)
	f.register(fs)
	fs.Usage = func() { fmt.Fprint(os.Stderr, usage) }
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() > 0 {
		fmt.Fprintf(os.Stderr, "iridium: %q is not an option\n\n%s", fs.Arg(0), usage)
		return 2
	}
	t, err := f.terms()
	if err != nil {
		fmt.Fprintf(os.Stderr, "iridium: %v\n", err)
		return 2
	}
	if window {
		if f.config != config.DefaultPath() {
			os.Setenv("IRIDIUM_CONFIG", f.config) // the window's own Iridium (internal/desktop local.go)
		}
		return desktop.Main(desktop.Options{NoServer: f.noServer, Join: t})
	}
	if f.noServer && len(t.Addrs) == 0 {
		fmt.Fprint(os.Stderr, "iridium: nothing to run: --no-server with no --join\n\n"+usage)
		return 2
	}
	if len(t.Addrs) == 0 {
		return serve(f.config)
	}
	// Joins beside (or instead of) this computer's Iridium: they end when it does. With no server
	// here to update the binary, each follows its Iridium's release.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := desktop.RunJoins(ctx, t, f.noServer, log.Printf); err != nil {
			log.Print(err)
		}
	}()
	code := 0
	if f.noServer {
		<-ctx.Done()
	} else {
		code = serve(f.config)
	}
	stop()
	<-done
	return code
}

// joinArgs are the older `iridium join <address> [options]` and `iridium headless [options]
// [address...]` as options: each address a --join.
func joinArgs(args []string) []string {
	var out []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		name := strings.TrimLeft(a, "-")
		switch {
		case strings.HasPrefix(a, "-") && !strings.Contains(a, "=") && (name == "name" || name == "roots" || name == "agents" || name == "config"):
			out = append(out, a)
			if i+1 < len(args) {
				i++
				out = append(out, args[i])
			}
		case strings.HasPrefix(a, "-"):
			out = append(out, a)
		default:
			out = append(out, "--join", a)
		}
	}
	return out
}
