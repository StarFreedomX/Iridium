package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"strings"
	"time"
)

// loginEnv takes the environment the person's login shell sets up: an app started from the Finder
// or the Dock gets launchd's (PATH /usr/bin:/bin:/usr/sbin:/sbin), with none of what the shell's
// files add (Homebrew, npm's and ~/.local/bin, the agents' keys), and found no agents to offer
// (kumo, 2026-11-20). What the shell says goes in; PATH is the shell's. Not on Windows, whose
// programs get the person's own environment.
func loginEnv(logf func(string, ...any)) {
	if isWindows {
		return
	}
	sh := os.Getenv("SHELL")
	if sh == "" {
		sh = "/bin/zsh"
		if _, err := os.Stat(sh); err != nil {
			sh = "/bin/sh"
		}
	}
	const start, end = "__ir_app_env_start__", "__ir_app_env_end__"
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	// Interactive and login, as a terminal's: what .zshrc and .zprofile add both.
	cmd := exec.CommandContext(ctx, sh, "-ilc", "printf '%s\\0' "+start+"; env -0; printf '%s\\0' "+end)
	cmd.Stdin = nil
	out, err := cmd.Output()
	if err != nil && len(out) == 0 {
		logf("login shell %s: %v", sh, err)
		return
	}
	i := bytes.Index(out, []byte(start+"\x00"))
	j := bytes.LastIndex(out, []byte(end+"\x00"))
	if i < 0 || j < i {
		logf("login shell %s: no environment", sh)
		return
	}
	n := 0
	for _, kv := range strings.Split(string(out[i+len(start)+1:j]), "\x00") {
		k, v, ok := strings.Cut(kv, "=")
		if !ok || k == "" || strings.HasPrefix(k, "IRIDIUM_") || strings.HasPrefix(k, "IR_APP_") {
			continue
		}
		switch k {
		case "PWD", "OLDPWD", "SHLVL", "_", "TERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM_SESSION_ID":
			continue
		}
		if _, set := os.LookupEnv(k); set && k != "PATH" {
			continue
		}
		os.Setenv(k, v)
		n++
	}
	logf("login shell %s: %d variables, PATH %s", sh, n, os.Getenv("PATH"))
}
