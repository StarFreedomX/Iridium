package desktop

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/version"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// follow draws the tray again when what the runtime says changes (its joins' states, this
// computer's Iridium's), looked at every few seconds: the runtime is another process.
func (u *ui) follow() {
	last := ""
	for {
		time.Sleep(3 * time.Second)
		r, ok := RuntimeRecord()
		var b strings.Builder
		fmt.Fprint(&b, ok, r.Server)
		keys := make([]string, 0, len(r.Joins))
		for k := range r.Joins {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			fmt.Fprint(&b, k, r.Joins[k])
		}
		if s := b.String(); s != last {
			last = s
			if u.app != nil {
				application.InvokeAsync(u.redraw)
			}
		}
	}
}

// binaryUpdates: the app updates as this computer's Iridium does (internal/update replaces the
// one binary, and on macOS signs the app again); the window, still on the one it started with,
// offers a restart once the binary on disk is another version. Looked at now and then.
func (u *ui) binaryUpdates() {
	for {
		u.checkBinary()
		time.Sleep(30 * time.Minute)
	}
}

// checkBinary asks the binary on disk its version (iridium version).
func (u *ui) checkBinary() {
	self, err := os.Executable()
	if err != nil {
		return
	}
	if r, err := filepath.EvalSymlinks(self); err == nil {
		self = r
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, self, "version")
	quiet(cmd)
	out, err := cmd.Output()
	if err != nil {
		return
	}
	v := strings.TrimSpace(strings.TrimPrefix(string(bytes.TrimSpace(out)), "iridium "))
	u.mu.Lock()
	changed := v != "" && v != version.Version && v != u.ready
	if changed {
		u.ready = v
	}
	u.mu.Unlock()
	if changed && u.app != nil {
		application.InvokeAsync(u.redraw)
	}
}

// restartApp starts the window again on the binary on disk and quits this one; the runtime is
// another process and runs on.
func (u *ui) restartApp() {
	self, err := os.Executable()
	if err != nil {
		return
	}
	cmd := exec.Command(self, "app")
	// The new one waits for this one to end first: one window runs at a time (SingleInstance).
	cmd.Env = append(os.Environ(), fmt.Sprintf("IRIDIUM_WAIT_PID=%d", os.Getpid()))
	Detach(cmd)
	if cmd.Start() != nil {
		return
	}
	_ = cmd.Process.Release()
	u.app.Quit()
}
