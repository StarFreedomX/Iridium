package desktop

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/kumoSleeping/iridium/internal/config"
)

// The Iridium on this computer (docs/app.md "本机"): the daemon this same binary is, run as the
// user's service (iridium install -now: systemd, launchd, a logon task) so that it outlives the
// window and the app. A first start of the app puts it in the list and shows it; later starts show
// the one shown last. The app never joins it: it is this computer.

// selfExe is this binary, which is the daemon too; startWait, how long a daemon just started has
// to answer. Tests change them.
var (
	selfExe   = os.Executable
	startWait = 30 * time.Second
)

// localPath is the daemon's config file: IRIDIUM_CONFIG (tests), else its default.
func localPath() string {
	if p := os.Getenv("IRIDIUM_CONFIG"); p != "" {
		return p
	}
	return config.DefaultPath()
}

// localAddress is where the window finds this computer's Iridium: its public address when it has
// one (on loopback its page answers that host only), else its listening address on loopback.
func localAddress() (string, error) {
	cfg, err := config.Load(localPath())
	if err != nil {
		return "", err
	}
	// The window stays on loopback when its Iridium lets it (public.localWindow, set as the app
	// turns 公网访问 on): no login for it there.
	if cfg.Public.Origin != "" && !cfg.Public.LocalWindow {
		return normalize(cfg.Public.Origin)
	}
	host, port, err := net.SplitHostPort(cfg.Listen)
	if err != nil {
		return "", fmt.Errorf("listen %q: %w", cfg.Listen, err)
	}
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port), nil
}

// localState is the local Iridium's, for the pages and the tray: "" not in the list, else
// starting, running, or what stopped it.
type localState struct {
	mu    sync.Mutex
	state string // "启动中", "运行中", or an error's short words
	err   error
	busy  bool
}

// errBusy: another ensure is at it; that one's end says how it went.
var errBusy = errors.New("busy")

const (
	localStarting = "启动中"
	localRunning  = "运行中"
)

func (l *localState) get() (string, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.state, l.err
}

func (l *localState) set(state string, err error) {
	l.mu.Lock()
	l.state, l.err = state, err
	l.mu.Unlock()
}

// ensure has this computer's Iridium running at address: already answering, else installed as the
// user's service and started (iridium install -now), else, where that cannot be, started by the
// app on its own, apart from it. It returns once it answers, or with why not.
func (l *localState) ensure(ctx context.Context, address string, logf func(string, ...any)) error {
	l.mu.Lock()
	if l.busy {
		l.mu.Unlock()
		return errBusy
	}
	l.busy = true
	l.mu.Unlock()
	defer func() {
		l.mu.Lock()
		l.busy = false
		l.mu.Unlock()
	}()
	if answers(ctx, address) {
		l.set(localRunning, nil)
		nameHost(logf)
		return nil
	}
	l.set(localStarting, nil)
	self, err := selfExe()
	if err == nil {
		self, err = filepath.EvalSymlinks(self)
	}
	if err != nil {
		l.set("未运行", err)
		return err
	}
	// ir started as the user's service (ir start --headless): its runtime starts this
	// computer's Iridium, as the settings have it on.
	_ = SetServer(true)
	// The runtime already runs (an Iridium is joined): it reads the settings every 2 seconds and
	// starts this computer's Iridium itself. ir start would start the runtime again, and every
	// join's connection with it (kumo, 2026-11-22: 此电脑 turned on, the others were cut off).
	if _, running := RuntimeRecord(); running && waitAnswer(ctx, address, startWait) {
		l.set(localRunning, nil)
		nameHost(logf)
		return nil
	}
	cmd := exec.CommandContext(ctx, self, "start", "--headless", "--as-is", "-config", localPath())
	quiet(cmd)
	out, err := cmd.CombinedOutput()
	logf("local: ir start --headless: %v\n%s", err, out)
	if err == nil && waitAnswer(ctx, address, startWait) {
		l.set(localRunning, nil)
		nameHost(logf)
		return nil
	}
	// No user service here (no systemd for the user, say): the runtime on its own, apart from the
	// app, so that it keeps running when the app quits. It runs till the computer restarts.
	serve := exec.Command(self, "run", "-config", localPath())
	quiet(serve)
	detach(serve)
	if err := serve.Start(); err != nil {
		l.set("未运行", err)
		return err
	}
	logf("local: iridium run started apart, pid %d", serve.Process.Pid)
	_ = serve.Process.Release()
	if waitAnswer(ctx, address, startWait) {
		l.set(localRunning, nil)
		nameHost(logf)
		return nil
	}
	err = errors.New("本机 Iridium 未响应")
	l.set("未运行", err)
	return err
}

// answers: is an Iridium at address (its /_ir/health)?
func answers(ctx context.Context, address string) bool {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return isIridium(ctx, address) == nil
}

func waitAnswer(ctx context.Context, address string, d time.Duration) bool {
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		if answers(ctx, address) {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(500 * time.Millisecond):
		}
	}
	return false
}
