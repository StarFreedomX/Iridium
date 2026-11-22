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
	"sync"
	"time"

	"github.com/kumoSleeping/iridium/internal/version"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
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

// syncRuntime keeps ir's service as the settings need it (kumo, 2026-11-22): started once
// something needs it (an Iridium joined here; this computer's own is started by startLocal),
// taken away once nothing does, the window then only showing others. Looked at as the settings
// change.
func (u *ui) syncRuntime(logf func(string, ...any)) {
	var seen time.Time
	for {
		if p, err := configPath(); err == nil {
			if t := modTime(p); !t.Equal(seen) {
				seen = t
				_, running := RuntimeRecord()
				c, _ := loadConfig()
				need := Needed()
				self, err := os.Executable()
				switch {
				case err != nil:
				case need && !running && !c.serverOn():
					cmd := exec.Command(self, "start", "--headless", "--as-is")
					quiet(cmd)
					out, err := cmd.CombinedOutput()
					logf("runtime: ir start --headless --as-is: %v\n%s", err, out)
				case !need && running:
					cmd := exec.Command(self, "stop")
					quiet(cmd)
					out, err := cmd.CombinedOutput()
					logf("runtime: ir stop: %v\n%s", err, out)
				}
			}
		}
		time.Sleep(2 * time.Second)
	}
}

// keepFrame: the window opens where and as large as it was last (Config.Frame), and is kept as it
// moves and resizes (a Mac's or Windows' window does).
func (u *ui) keepFrame() {
	c, _ := loadConfig()
	if f := c.Frame; f.W >= 360 && f.H >= 480 {
		u.win.SetSize(f.W, f.H)
		u.win.SetPosition(f.X, f.Y)
	}
	var mu sync.Mutex
	var t *time.Timer
	save := func(*application.WindowEvent) {
		mu.Lock()
		defer mu.Unlock()
		if t != nil {
			t.Stop()
		}
		t = time.AfterFunc(700*time.Millisecond, func() {
			if u.win.IsMaximised() || u.win.IsFullscreen() || u.win.IsMinimised() {
				return
			}
			x, y := u.win.Position()
			w, h := u.win.Size()
			_, _ = updateConfig(func(c *Config) { c.Frame = Frame{X: x, Y: y, W: w, H: h} })
		})
	}
	u.win.OnWindowEvent(events.Common.WindowDidMove, save)
	u.win.OnWindowEvent(events.Common.WindowDidResize, save)
}
