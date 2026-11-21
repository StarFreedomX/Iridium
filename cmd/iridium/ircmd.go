package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/kumoSleeping/iridium/internal/agents"
	"github.com/kumoSleeping/iridium/internal/config"
	"github.com/kumoSleeping/iridium/internal/desktop"
	"github.com/kumoSleeping/iridium/internal/install"
)

// ir start, stop, server, join, leave (docs/app.md "运行时"): ir as the user's service, the
// runtime (iridium run), and what it holds: this computer's Iridium on or off, the Iridiums it
// joins. The settings are the app's (desktop.Config), the same the window's switches change; the
// runtime follows them live.

const runtimeUsage = `  ir start [--headless] [--no-server] [--join <address> [options]]...
                                   ir as this computer's service (at login, too), and its window
                                   unless --headless; --no-server: no Iridium of its own here
  ir stop                          the service stopped and taken away (the settings kept)
  ir server on|off                 this computer's own Iridium on or off
  ir join <address> [--name <name>] [--roots <dir>,...] [--no-shell] [--agents <agent>,...] [--proxy]
                                   this computer joined to that Iridium (an executor), kept
  ir leave <address>               not joined to it any more
  ir status                        the version, and what runs here
  ir serve [--no-server] [--join <address>]...
                                   the same in this terminal, till it closes
`

// byAgent: does an agent run this (a session's ir), not a person at a terminal? What starts at
// login is a person's to say.
func byAgent() bool {
	if os.Getenv("CLAUDECODE") != "" {
		return true
	}
	for _, k := range agents.SessionVars() {
		if os.Getenv(k) != "" {
			return true
		}
	}
	return false
}

func refuseAgent(cmd string) bool {
	if byAgent() {
		fmt.Fprintf(os.Stderr, "ir %s 改的是这台电脑的开机自启和接入，要人在终端里运行；agent 不能替你运行。\n", cmd)
		return true
	}
	return false
}

// runtimeCmd is ir's start, stop, server, join, leave; ok false: not one of them.
func runtimeCmd(args []string) (int, bool) {
	if len(args) == 0 {
		return 0, false
	}
	switch args[0] {
	case "start":
		return startCmd(args[1:]), true
	case "stop":
		return stopCmd(args[1:]), true
	case "server":
		return serverCmd(args[1:]), true
	case "join":
		return joinCmd(args[1:]), true
	case "leave":
		return leaveCmd(args[1:]), true
	case "status":
		return statusCmd(args[1:]), true
	case "serve":
		return run(args[1:], false), true
	}
	return 0, false
}

// startCmd is ir start: the settings changed as asked (--no-server, --join), the binary placed,
// the service that runs the runtime written and started (again, on this binary, if it ran), and
// the window opened unless --headless (or there is no screen).
func startCmd(args []string) int {
	if refuseAgent("start") {
		return 2
	}
	fs := flag.NewFlagSet("ir start", flag.ContinueOnError)
	var rf runFlags
	rf.register(fs)
	headless := fs.Bool("headless", false, "no window")
	proxy := fs.Bool("proxy", false, "fetch iridium through the Iridiums joined, not from GitHub")
	unit := fs.String("unit", "iridium", "the service's name")
	prefix, bin := placeFlags(fs)
	fs.Usage = func() { fmt.Fprint(os.Stderr, "usage:\n"+runtimeUsage) }
	if err := fs.Parse(args); err != nil {
		return 2
	}
	t, err := rf.terms()
	if err != nil {
		fmt.Fprintf(os.Stderr, "ir start: %v\n", err)
		return 2
	}
	t.Proxy = *proxy
	if rf.noServer {
		if err := desktop.SetServer(false); err != nil {
			return failedCmd("start", err)
		}
	}
	if len(t.Addrs) > 0 {
		if err := desktop.Join(t); err != nil {
			return failedCmd("start", err)
		}
	}
	if err := startRuntime(rf.config, *unit, *prefix, *bin); err != nil {
		return failedCmd("start", err)
	}
	if !*headless && desktop.CanShow() {
		openWindow()
	}
	printStatus(rf.config, *unit)
	return 0
}

// startRuntime has the runtime running as the service: written (again) and started, started
// again if it ran (it may run an older binary), and waited for.
func startRuntime(cfg, unit, prefix, bin string) error {
	_, running := desktop.RuntimeRecord()
	s := service{config: cfg, unit: unit, prefix: prefix, bin: bin, now: true, reload: true, restart: running, command: "run"}
	if _, err := s.register(); err != nil {
		return err
	}
	for end := time.Now().Add(20 * time.Second); time.Now().Before(end); time.Sleep(300 * time.Millisecond) {
		if r, ok := desktop.RuntimeRecord(); ok && (!running || time.Since(r.Since) < 30*time.Second) {
			return nil
		}
	}
	return fmt.Errorf("ir 20 秒内没有起来（ir status 看服务的状态）")
}

// openWindow starts the window apart (one runs already: it shows that one).
func openWindow() {
	self, err := os.Executable()
	if err != nil {
		return
	}
	cmd := exec.Command(self, "app")
	desktop.Detach(cmd)
	if cmd.Start() == nil {
		_ = cmd.Process.Release()
	}
}

// stopCmd is ir stop: the service stopped and taken away; settings, binary and state kept.
func stopCmd(args []string) int {
	if refuseAgent("stop") {
		return 2
	}
	fs := flag.NewFlagSet("ir stop", flag.ContinueOnError)
	unit := fs.String("unit", "iridium", "the service's name")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if err := install.Uninstall(*unit, func(f string, a ...any) { fmt.Printf(f+"\n", a...) }); err != nil {
		return failedCmd("stop", err)
	}
	return 0
}

// serverCmd is ir server on|off.
func serverCmd(args []string) int {
	if len(args) != 1 || (args[0] != "on" && args[0] != "off") {
		fmt.Fprintln(os.Stderr, "usage: ir server on|off")
		return 2
	}
	if refuseAgent("server") {
		return 2
	}
	if err := desktop.SetServer(args[0] == "on"); err != nil {
		return failedCmd("server", err)
	}
	return applied("server", config.DefaultPath())
}

// joinCmd is ir join <address> [options]: kept in the settings; ir started if it is not (with no
// Iridium of its own when it never ran here: one only joining asked for none).
func joinCmd(args []string) int {
	if refuseAgent("join") {
		return 2
	}
	fs := flag.NewFlagSet("ir join", flag.ContinueOnError)
	var rf runFlags
	rf.register(fs)
	proxy := fs.Bool("proxy", false, "fetch iridium through that Iridium, not from GitHub")
	fs.Usage = func() { fmt.Fprint(os.Stderr, "usage:\n"+runtimeUsage) }
	if err := fs.Parse(joinArgs(args)); err != nil {
		return 2
	}
	if len(rf.joins) == 0 {
		fs.Usage()
		return 2
	}
	t, err := rf.terms()
	if err != nil {
		return failedCmd("join", err)
	}
	t.Proxy = *proxy
	fresh := desktop.Fresh()
	if err := desktop.Join(t); err != nil {
		return failedCmd("join", err)
	}
	if fresh {
		_ = desktop.SetServer(false)
	}
	return applied("join", rf.config)
}

// leaveCmd is ir leave <address>.
func leaveCmd(args []string) int {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "usage: ir leave <address>")
		return 2
	}
	if refuseAgent("leave") {
		return 2
	}
	if err := desktop.Leave(args[0]); err != nil {
		return failedCmd("leave", err)
	}
	return applied("leave", config.DefaultPath())
}

// applied: the runtime takes the settings at once; one not running is started.
func applied(cmd, cfg string) int {
	if _, ok := desktop.RuntimeRecord(); !ok {
		home, _ := os.UserHomeDir()
		prefix := filepath.Join(home, ".local", "opt", "iridium")
		bin := filepath.Join(home, ".local", "bin")
		if d := os.Getenv("LOCALAPPDATA"); d != "" && filepath.Separator == '\\' {
			prefix, bin = filepath.Join(d, "Iridium"), filepath.Join(d, "Iridium")
		}
		if err := startRuntime(cfg, "iridium", prefix, bin); err != nil {
			return failedCmd(cmd, err)
		}
	} else {
		time.Sleep(3 * time.Second) // its next look at the settings
	}
	printStatus(cfg, "iridium")
	return 0
}

func failedCmd(cmd string, err error) int {
	fmt.Fprintf(os.Stderr, "ir %s: %v\n", cmd, err)
	return 1
}

// runtimeMain is iridium run: the runtime, as the service runs it.
func runtimeMain(args []string) int {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	cfg := fs.String("config", config.DefaultPath(), "this computer's Iridium's config file")
	fs.Parse(args)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return desktop.Runtime(ctx, desktop.RuntimeOptions{Config: *cfg, Logf: log.Printf})
}
