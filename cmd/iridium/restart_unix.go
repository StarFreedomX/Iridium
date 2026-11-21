//go:build !windows

package main

import (
	"bufio"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// restart restarts the daemon with the new binary: its systemd unit, if it runs in one, else this
// process in place (macOS, under launchd or not: the job's pid stays the same). The holders run
// in units of their own and keep running either way.
func restart() error {
	if unit := ownUnit(); unit != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, "systemctl", "--user", "restart", "--no-block", unit).Run()
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return syscall.Exec(exe, os.Args, os.Environ())
}

// ownUnit is the user service this process runs in, from its cgroup; "" for none.
func ownUnit() string {
	if os.Getenv("INVOCATION_ID") == "" {
		return ""
	}
	f, err := os.Open("/proc/self/cgroup")
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		_, path, _ := strings.Cut(sc.Text(), "::")
		if name := filepath.Base(path); strings.HasSuffix(name, ".service") && strings.Contains(path, "/user@") {
			return name
		}
	}
	return ""
}
