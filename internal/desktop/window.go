package desktop

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/kumoSleeping/iridium/internal/version"
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
			u.redraw()
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
	if changed {
		u.redraw()
	}
}

// restartApp starts the window again on the binary on disk and quits this one; the runtime is
// another process and runs on. mygo's Relaunch starts the new one once this one has ended (its
// single-instance lock), as IRIDIUM_WAIT_PID did; on a Mac through Launch Services, the app's
// bundle as updated.
func (u *ui) restartApp() { mygo.App.Relaunch() }

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

// keepFrame: a window on an Iridium opens where and as large as one was last (Config.Frame, given
// as it is made), and that is kept as w moves and resizes.
func (u *ui) keepFrame(w *mygo.Window) {
	var mu sync.Mutex
	var t *time.Timer
	save := func() {
		mu.Lock()
		defer mu.Unlock()
		if t != nil {
			t.Stop()
		}
		t = time.AfterFunc(700*time.Millisecond, func() {
			u.mu.Lock()
			here := slices.Contains(u.wins, w)
			u.mu.Unlock()
			if !here || w.IsMaximized() || w.IsFullScreen() || w.IsMinimized() {
				return
			}
			x, y := w.Position()
			ww, h := w.Size()
			_, _ = updateConfig(func(c *Config) { c.Frame = Frame{X: x, Y: y, W: ww, H: h} })
		})
	}
	w.OnMove(save)
	w.OnResize(save)
}
