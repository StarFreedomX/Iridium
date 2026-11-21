// Package install is `iridium install`: the user systemd unit iridium.service that runs the daemon
// (plan "测试部署"), its config file and its state directory. It never starts the service: that
// is yours to do.
package install

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"

	"github.com/kumoSleeping/iridium/internal/config"
	"github.com/kumoSleeping/iridium/internal/launchd"
)

var unitName = regexp.MustCompile(`^[a-zA-Z0-9_.@-]{1,200}$`)

type Options struct {
	Exe        string // the binary the unit runs
	ConfigPath string // the daemon's config file; made with the defaults if missing
	Listen     string // the address a config made now listens on; "" is the default
	UnitDir    string // user units: ~/.config/systemd/user
	Unit       string // "" is iridium
	Path       string // the PATH the daemon and its agents run with; "" is none set
	// Env are more NAME=VALUE the daemon runs with (a test's HOME, CODEX_HOME...).
	Env []string
	// Systemctl runs systemctl --user with args; nil runs nothing.
	Systemctl func(args ...string) error
	Now       bool // enable and start it too
	// Command is what the service runs of iridium's: "" is serve (the daemon alone); ir start's
	// is run (the runtime).
	Command string
	// Args are more of its own (--no-server, --join A, ...), written after it as given.
	Args []string
	// Restart: started already, it is started again (on the binary just placed).
	Restart bool
	Linger string // the file that says the user lingers; "" is /var/lib/systemd/linger/<user>
	Out    io.Writer

	// Launchd writes a LaunchAgent (macOS) into UnitDir (~/Library/LaunchAgents) instead of a
	// systemd unit, the daemon's output going to Log; with Now, Launchctl loads it into Domain.
	Launchd   bool
	Log       string
	Launchctl launchd.Launchctl
	Domain    string

	// Task registers a Task Scheduler task (Windows) that runs the daemon at the user's logon,
	// through Schtasks (schtasks.exe's arguments; nil runs nothing); with Now it runs it too.
	// User is the account it runs as (DOMAIN\name).
	Task     bool
	Schtasks func(args ...string) error
	User     string
}

// Unit is the unit file. env: more NAME=VALUE for the daemon.
func Unit(exe, configPath, path string, env ...string) string {
	return UnitArgs(exe, configPath, path, nil, env...)
}

// UnitArgs is Unit with more of serve's arguments (Options.Args).
func UnitArgs(exe, configPath, path string, args []string, env ...string) string {
	return unitOf(exe, "serve", configPath, path, args, env...)
}

func (o Options) command() string {
	if o.Command == "" {
		return "serve"
	}
	return o.Command
}

func unitOf(exe, command, configPath, path string, args []string, env ...string) string {
	if path != "" {
		env = append([]string{"PATH=" + path}, env...)
	}
	lines := ""
	for _, e := range env {
		lines += "Environment=" + quote(e) + "\n"
	}
	return fmt.Sprintf(`# Written by iridium install.
[Unit]
Description=Iridium
After=network.target

[Service]
Type=exec
ExecStart=%s %s -config %s%s
%sRestart=on-failure
RestartSec=2
# The holders are units of their own (systemd-run --user): a restart or an update leaves the
# agents running.

[Install]
WantedBy=default.target
`, quote(exe), command, quote(configPath), unitArgs(args), lines)
}

func unitArgs(args []string) string {
	s := ""
	for _, a := range args {
		s += " " + quote(a)
	}
	return s
}

// quote quotes a word for a unit file when it needs it.
func quote(s string) string {
	if !strings.ContainsAny(s, " \t\"'\\%$;") {
		return s
	}
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`, "%", "%%", "$", "$$").Replace(s) + `"`
}

func Install(o Options) error {
	if o.Unit == "" {
		o.Unit = "iridium"
	}
	if o.Out == nil {
		o.Out = io.Discard
	}
	if !filepath.IsAbs(o.Exe) || !filepath.IsAbs(o.ConfigPath) {
		return errors.New("install: the binary and the config need absolute paths")
	}
	if !unitName.MatchString(o.Unit) {
		return fmt.Errorf("install: %q is not a unit name", o.Unit)
	}
	for _, e := range o.Env {
		if k, _, ok := strings.Cut(e, "="); !ok || k == "" || strings.ContainsAny(e, "\n") {
			return fmt.Errorf("install: %q is not NAME=VALUE", e)
		}
	}
	cfg, err := config.Load(o.ConfigPath)
	if err != nil {
		return err
	}
	if _, err := os.Stat(o.ConfigPath); errors.Is(err, os.ErrNotExist) {
		if o.Listen != "" {
			cfg.Listen = o.Listen
		}
		if err := cfg.Save(o.ConfigPath); err != nil {
			return err
		}
		fmt.Fprintf(o.Out, "写了配置 %s（听 %s）。\n", o.ConfigPath, cfg.Listen)
	}
	if err := os.MkdirAll(cfg.StatePath(), 0o700); err != nil {
		return err
	}
	if o.Launchd {
		return installLaunchd(o, cfg)
	}
	if o.Task {
		return installTask(o, cfg)
	}
	if err := os.MkdirAll(o.UnitDir, 0o755); err != nil {
		return err
	}
	unit := filepath.Join(o.UnitDir, o.Unit+".service")
	tmp := unit + ".tmp"
	if err := os.WriteFile(tmp, []byte(unitOf(o.Exe, o.command(), o.ConfigPath, o.Path, o.Args, o.Env...)), 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, unit); err != nil {
		return err
	}
	fmt.Fprintf(o.Out, "写了 %s：%s %s，状态在 %s。\n", unit, o.Exe, o.command(), cfg.StatePath())
	if o.Systemctl != nil {
		steps := [][]string{{"daemon-reload"}}
		if o.Now {
			steps = append(steps, []string{"enable", "--now", o.Unit + ".service"})
			if o.Restart {
				steps = append(steps, []string{"restart", o.Unit + ".service"})
			}
		}
		for _, s := range steps {
			if err := o.Systemctl(s...); err != nil {
				return fmt.Errorf("systemctl --user %s: %w", strings.Join(s, " "), err)
			}
		}
	}
	if !o.Now {
		fmt.Fprintf(o.Out, "启动：systemctl --user enable --now %s.service\n", o.Unit)
	}
	linger := o.Linger
	if linger == "" {
		if u, err := user.Current(); err == nil {
			linger = filepath.Join("/var/lib/systemd/linger", u.Username)
		}
	}
	if _, err := os.Stat(linger); linger != "" && err != nil {
		fmt.Fprintf(o.Out, "注意：没开 linger，你退出登录后服务和托管的 agent 都会停。要一直跑：sudo loginctl enable-linger %s\n", filepath.Base(linger))
	}
	return nil
}

// installLaunchd is Install on macOS: the LaunchAgent o.Unit, loaded at once with Now, else at
// the next login.
func installLaunchd(o Options, cfg config.Config) error {
	env := o.Env
	if o.Path != "" {
		env = append([]string{"PATH=" + o.Path}, env...)
	}
	job := launchd.Job{Label: o.Unit, Argv: append([]string{o.Exe, o.command(), "-config", o.ConfigPath}, o.Args...), Env: env, Log: o.Log}
	path, err := launchd.Write(o.UnitDir, job)
	if err != nil {
		return err
	}
	fmt.Fprintf(o.Out, "写了 %s：%s %s，状态在 %s。\n", path, o.Exe, o.command(), cfg.StatePath())
	if o.Now && o.Launchctl != nil {
		if err := launchd.Load(context.Background(), o.Launchctl, o.Domain, o.Unit, path); err != nil {
			return err
		}
		fmt.Fprintf(o.Out, "已启动（launchctl print %s/%s）。\n", o.Domain, o.Unit)
		return nil
	}
	fmt.Fprintf(o.Out, "下次登录时启动；现在启动：launchctl bootstrap gui/%d %s\n", os.Getuid(), path)
	return nil
}

// Place keeps the binary at prefix/iridium (iridium.exe on Windows), copying exe there when it
// runs from elsewhere (a release just unpacked), and links bin/ir to it; bin "" links nothing. It
// gives where the binary is now. An ir that is a file of its own (not a link) is left alone. On
// Windows bin gets ir.cmd and goes on the user's Path.
func Place(exe, prefix, bin string) (string, error) {
	dst := filepath.Join(prefix, exeName)
	if same(exe, dst) {
		return dst, link(dst, bin)
	}
	if err := os.MkdirAll(prefix, 0o755); err != nil {
		return "", err
	}
	// The macOS app's own binary is not copied out: prefix/iridium is a link to it, so the app and
	// the service are one program, updated (and signed again) in one place.
	if InBundle(exe) {
		tmp := dst + ".new"
		os.Remove(tmp)
		if err := os.Symlink(exe, tmp); err != nil {
			return "", err
		}
		if err := os.Rename(tmp, dst); err != nil {
			return "", err
		}
		return exe, link(dst, bin)
	}
	in, err := os.Open(exe)
	if err != nil {
		return "", err
	}
	defer in.Close()
	tmp, err := os.CreateTemp(prefix, ".iridium-install-*")
	if err != nil {
		return "", err
	}
	_, err = io.Copy(tmp, in)
	if err == nil {
		err = tmp.Chmod(0o755)
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = swap(tmp.Name(), dst)
	}
	if err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	return dst, link(dst, bin)
}

// InBundle: is exe the binary of a macOS app (…/X.app/Contents/MacOS/…)?
func InBundle(exe string) bool {
	return runtime.GOOS == "darwin" && strings.Contains(exe, ".app/Contents/MacOS/")
}

// Bundle is the app exe is in ("" none).
func Bundle(exe string) string {
	if i := strings.Index(exe, ".app/Contents/MacOS/"); i >= 0 && runtime.GOOS == "darwin" {
		return exe[:i+len(".app")]
	}
	return ""
}

func same(a, b string) bool {
	fa, err := os.Stat(a)
	if err != nil {
		return false
	}
	fb, err := os.Stat(b)
	return err == nil && os.SameFile(fa, fb)
}
