package main

import (
	"bytes"
	"context"
	"strings"
	"sync"
	"time"

	"github.com/kumoSleeping/iridium/internal/join"
)

// prog is how the app says itself in its pairing and hello: the Iridium marks it as the app's.
// Update is off: the app updates as itself, not to its Iridium's release (update.go).
var prog = join.Program{Name: "ir-app", Self: "ir-app", Usage: usage}

// Joins runs this computer's join to each Iridium that is on, each in its own goroutine, and keeps
// the last thing each said for the tray.
type Joins struct {
	Ask     func(context.Context, string) bool // nil: none here to ask (a grant is turned down)
	Changed func()                             // a status changed
	// Terminal: asked at the terminal it runs in (headless), as ir-computer asks, when Ask is nil.
	Terminal bool
	Logf     func(string, ...any)

	mu      sync.Mutex
	running map[string]context.CancelFunc
	status  map[string]string
}

// Status is what the join to address said last.
func (j *Joins) Status(address string) string {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.status[address]
}

// Sync starts the joins of c's servers that are on and stops the others.
func (j *Joins) Sync(c Config) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.running == nil {
		j.running, j.status = map[string]context.CancelFunc{}, map[string]string{}
	}
	want := map[string]bool{}
	for _, s := range c.Servers {
		if !s.Off {
			want[s.URL] = true
		}
	}
	for u, stop := range j.running {
		if !want[u] {
			stop()
			delete(j.running, u)
			j.status[u] = "已断开"
		}
	}
	for u := range want {
		if j.running[u] == nil {
			ctx, stop := context.WithCancel(context.Background())
			j.running[u] = stop
			j.status[u] = "连接中"
			go j.run(ctx, u, c)
		}
	}
}

// Stop ends every join (the app quitting): the agents they started end with them.
func (j *Joins) Stop() {
	j.mu.Lock()
	defer j.mu.Unlock()
	for u, stop := range j.running {
		stop()
		delete(j.running, u)
	}
}

func (j *Joins) run(ctx context.Context, address string, c Config) {
	base, err := join.BaseDir()
	if err != nil {
		j.set(address, "无法启动："+err.Error())
		return
	}
	o := join.Options{
		URL: address, Name: c.Name, Roots: c.Roots, Shell: !c.NoShell, Base: base, Prog: prog,
		Out: lineWriter(func(l string) { j.set(address, l) }), Logf: j.Logf, Ask: j.Ask,
	}
	if o.Name == "" {
		o.Name = join.MachineName()
	}
	if o.Ask == nil && !j.Terminal {
		// None to ask: whatever is not allowed already stays so.
		o.Ask = func(context.Context, string) bool { return false }
	}
	// A join ends on its own only for good (another runs for the same Iridium here); it is tried
	// again now and then, in case that one ends.
	for ctx.Err() == nil {
		if err := o.Run(ctx); err != nil && ctx.Err() == nil {
			j.set(address, err.Error())
		}
		select {
		case <-ctx.Done():
		case <-time.After(30 * time.Second):
		}
	}
}

func (j *Joins) set(address, line string) {
	// The terminal's wording: the app has no window to close for it.
	line, _, _ = strings.Cut(line, "：关闭此窗口即断开")
	j.mu.Lock()
	j.status[address] = line
	j.mu.Unlock()
	if j.Logf != nil {
		j.Logf("%s: %s", address, line)
	}
	if j.Changed != nil {
		j.Changed()
	}
}

// lineWriter calls f with each whole line written to it.
type lineWriter func(string)

func (f lineWriter) Write(p []byte) (int, error) {
	for _, l := range bytes.Split(bytes.TrimRight(p, "\n"), []byte("\n")) {
		if s := strings.TrimSpace(strings.TrimPrefix(string(l), "\a")); s != "" {
			f(s)
		}
	}
	return len(p), nil
}
