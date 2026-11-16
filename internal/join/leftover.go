package join

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// Before 2026-11-16 a join could start at login (--install): a scheduled task (Windows), a
// LaunchAgent (macOS) or a systemd user unit (Linux), named iridium-join-<key>, running it again
// with --resident. It runs in the foreground only now; what is left of that goes once it runs:
// the entry, the one it started, and ir-computer where the old line put it.

// runner runs a command, failing with its output.
type runner func(name string, args ...string) error

// sysRun runs the system's commands (tests: a fake).
var sysRun runner = runCmd

func runCmd(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %v: %s", name, strings.Join(args, " "), err, bytes.TrimSpace(out))
	}
	return nil
}

// oldName is the entry's name for this Iridium.
func (o *Options) oldName() string { return "iridium-join-" + o.key() }

// oldFile is where the entry's definition is (macOS, Linux).
func oldFile(goos, name string) string {
	home, _ := os.UserHomeDir()
	if goos == "darwin" {
		return filepath.Join(home, "Library", "LaunchAgents", name+".plist")
	}
	dir := filepath.Join(home, ".config")
	if d := os.Getenv("XDG_CONFIG_HOME"); d != "" {
		dir = d
	}
	return filepath.Join(dir, "systemd", "user", name+".service")
}

// removeOld removes the login entry for this Iridium and stops what it started, if there is one,
// and the ir-computer the old line downloaded.
func (o *Options) removeOld(run runner) error {
	removed, err := removeEntry(runtime.GOOS, o.oldName(), run, true)
	if removed {
		o.say("已移除登录时运行项 %s", o.oldName())
	}
	if exe := oldComputer(runtime.GOOS); exe != "" && exe != selfExe() {
		_ = os.Remove(exe)
	}
	return err
}

// removeEntry removes the entry name; with stop, what runs by it ends too (not when that is the
// caller).
func removeEntry(goos, name string, run runner, stop bool) (bool, error) {
	if goos == "windows" {
		if run("schtasks", "/Query", "/TN", name) != nil {
			return false, nil
		}
		if stop {
			_ = run("schtasks", "/End", "/TN", name)
		}
		return true, run("schtasks", "/Delete", "/TN", name, "/F")
	}
	f := oldFile(goos, name)
	if _, err := os.Stat(f); err != nil {
		return false, nil
	}
	if goos == "darwin" {
		if stop {
			_ = run("launchctl", "bootout", "gui/"+strconv.Itoa(os.Getuid())+"/"+name)
		}
		return true, os.Remove(f)
	}
	if stop {
		_ = run("systemctl", "--user", "disable", "--now", name+".service")
	} else {
		_ = run("systemctl", "--user", "disable", name+".service")
	}
	if err := os.Remove(f); err != nil {
		return true, err
	}
	return true, run("systemctl", "--user", "daemon-reload")
}

// oldComputer is where the old line put ir-computer.
func oldComputer(goos string) string {
	if goos == "windows" {
		if d := os.Getenv("LOCALAPPDATA"); d != "" {
			return filepath.Join(d, "iridium", "ir-computer.exe")
		}
		return ""
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "bin", "ir-computer")
}

// leftover is a run by an old entry (--resident: an updated iridium's ir join): it removes the
// entry and ends cleanly (an entry starts it again only after a failure), so it is not started
// again.
func (p Program) leftover(args []string, stdout, stderr io.Writer) int {
	var u string
	for _, a := range args {
		if !strings.HasPrefix(a, "-") {
			u = a
			break
		}
	}
	addr, err := Address(u)
	if err != nil {
		fmt.Fprintf(stderr, "%s: %v\n", p.Name, err)
		return 0
	}
	o := Options{URL: addr, Out: stdout, Prog: p}
	if _, err := removeEntry(runtime.GOOS, o.oldName(), sysRun, false); err != nil {
		fmt.Fprintf(stderr, "%s: %v\n", p.Name, err)
	}
	fmt.Fprintf(stdout, "%s: 不再登录时运行，需要时在终端里运行 %s\n", p.Name, o.again())
	return 0
}
