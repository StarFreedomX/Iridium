package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/remote/wire"
)

// What it turned down (Denial.What).
const (
	DeniedShell  = "shell"  // a command line, command lines being off here
	DeniedPath   = "path"   // a file or folder outside its roots
	DeniedSecret = "secret" // a path it never serves (keys and logins)
)

// Denial is something it turned down, as its terminal is told (Options.Denied): What, the path
// (DeniedPath, DeniedSecret), who asked (the Iridium's event says; "" not known).
type Denial struct {
	What, Path, By string
}

// tellEvery: the same denial is told once in it.
const tellEvery = time.Minute

// deny tells the terminal of d, unless it was told of it within tellEvery.
func (e *Executor) deny(d Denial) {
	if e.o.Denied == nil {
		return
	}
	now := time.Now()
	e.mu.Lock()
	last, seen := e.told[d]
	if !seen || now.Sub(last) >= tellEvery {
		e.told[d] = now
	}
	for k, at := range e.told {
		if now.Sub(at) >= tellEvery {
			delete(e.told, k)
		}
	}
	e.mu.Unlock()
	if !seen || now.Sub(last) >= tellEvery {
		e.o.Denied(d)
	}
}

func (e *Executor) shellOn() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.shell
}

// Roots are the folders it serves files under now (none: all but those never served).
func (e *Executor) Roots() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return slices.Clone(e.roots)
}

// Busy is how many of the processes it started run still (agents, command lines).
func (e *Executor) Busy() int {
	e.mu.Lock()
	hs := make([]*holder, 0, len(e.holds))
	for _, h := range e.holds {
		hs = append(hs, h)
	}
	n := len(e.runs)
	e.mu.Unlock()
	for _, h := range hs {
		if h.state().Exit == nil {
			n++
		}
	}
	return n
}

// Shell: command lines run here now.
func (e *Executor) Shell() bool { return e.shellOn() }

// event is an event from the Iridium.
func (e *Executor) event(name string, params json.RawMessage) {
	if name != wire.EventDenied {
		return
	}
	var d wire.DeniedEvent
	if json.Unmarshal(params, &d) == nil && d.What == DeniedShell {
		e.deny(Denial{What: DeniedShell, By: d.By})
	}
}

// askFor is how long a grant waits for the person at its terminal: less than the Iridium waits.
var askFor = 80 * time.Second

// grant widens or narrows what it has as p asks: wider only if the person at its terminal says so.
func (e *Executor) grant(ctx context.Context, p wire.GrantParams) (any, error) {
	e.mu.Lock()
	shell, roots := e.shell, slices.Clone(e.roots)
	e.mu.Unlock()
	wantShell := p.Shell != nil && *p.Shell && !shell
	var more []string
	for _, r := range p.Roots {
		if r == "" || !filepath.IsAbs(r) {
			return nil, bad("not absolute: %s", r)
		}
		r = filepath.Clean(r)
		if len(roots) > 0 && !covered(roots, r) && !slices.Contains(more, r) {
			more = append(more, r)
		}
	}
	if wantShell || len(more) > 0 {
		var items []Item
		if wantShell {
			items = append(items, Item{Kind: ItemShell})
		}
		for _, r := range more {
			items = append(items, Item{Kind: ItemFolder, Value: r})
		}
		yes := e.askEach(ctx, p.By, items)
		if !slices.Contains(yes, true) {
			return nil, &wire.Error{Code: wire.CodeDenied, Message: "declined at that computer"}
		}
		// What was allowed of it, item by item.
		wantShell, more = false, nil
		for i, it := range items {
			if !yes[i] {
				continue
			}
			if it.Kind == ItemShell {
				wantShell = true
			} else {
				more = append(more, it.Value)
			}
		}
	}
	e.mu.Lock()
	if wantShell {
		e.shell = true
	}
	if p.Shell != nil && !*p.Shell {
		e.shell = false
	}
	e.roots = append(e.roots, more...)
	out := wire.Grant{Shell: e.shell, Roots: slices.Clone(e.roots)}
	e.mu.Unlock()
	if wantShell || len(more) > 0 {
		e.o.Logf("executor: granted: shell %v, roots %s", out.Shell, strings.Join(out.Roots, ", "))
		e.widened()
	}
	return out, nil
}

// What a request asks for, one thing at a time (Item.Kind).
const (
	ItemShell  = "shell"  // command lines
	ItemFolder = "folder" // a folder more (Value)
	ItemAgent  = "agent"  // an agent turned off, to start (Value, its name)
)

// Item is one thing a request from the Iridium asks for.
type Item struct {
	Kind  string `json:"kind"`
	Value string `json:"value,omitempty"`
}

// String is the item as a question says it (zh).
func (it Item) String() string {
	switch it.Kind {
	case ItemShell:
		return "开启命令行"
	case ItemFolder:
		return "访问 " + it.Value
	case ItemAgent:
		return "启动 " + it.Value
	}
	return it.Kind
}

// askEach asks the person here about items, one answer each: AskEach, else all of them in one
// question (Ask); no one there, or no answer in askFor, is no to all.
func (e *Executor) askEach(ctx context.Context, by string, items []Item) []bool {
	no := make([]bool, len(items))
	if e.o.AskEach == nil {
		var s []string
		for _, it := range items {
			s = append(s, it.String())
		}
		q := strings.Join(s, "，")
		if by != "" {
			q = by + " 请求" + q
		}
		if e.ask(ctx, q) {
			for i := range no {
				no[i] = true
			}
		}
		return no
	}
	e.asked.Lock()
	defer e.asked.Unlock()
	if ctx.Err() != nil {
		return no
	}
	ctx, cancel := context.WithTimeout(ctx, askFor)
	defer cancel()
	yes := e.o.AskEach(ctx, by, items)
	if len(yes) != len(items) || ctx.Err() != nil {
		return no
	}
	return yes
}

// widened tells its owner what it allows now (Options.Widened).
func (e *Executor) widened() {
	if e.o.Widened == nil {
		return
	}
	e.mu.Lock()
	shell, roots := e.shell, slices.Clone(e.roots)
	var off []string
	for a, o := range e.off {
		if o {
			off = append(off, a)
		}
	}
	e.mu.Unlock()
	slices.Sort(off)
	e.o.Widened(shell, roots, off)
}

// ask asks the person at its terminal q, one question at a time: no one there (Options.Ask nil),
// or no answer in askFor, is no.
func (e *Executor) ask(ctx context.Context, q string) bool {
	if e.o.Ask == nil {
		return false
	}
	e.asked.Lock()
	defer e.asked.Unlock()
	if ctx.Err() != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, askFor)
	defer cancel()
	return e.o.Ask(ctx, q) && ctx.Err() == nil
}

// covered: path is under one of roots (as given and with their links resolved).
func covered(roots []string, path string) bool {
	in := func(root, p string) bool {
		rel, err := filepath.Rel(root, p)
		return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
	}
	real := path
	if r, err := filepath.EvalSymlinks(path); err == nil {
		real = r
	}
	for _, r := range roots {
		if in(r, path) {
			return true
		}
		if rr, err := filepath.EvalSymlinks(r); err == nil && in(rr, real) {
			return true
		}
	}
	return false
}

// String is d as its terminal says it (zh).
func (d Denial) String() string {
	by := ""
	if d.By != "" {
		by = "（" + d.By + "）"
	}
	switch d.What {
	case DeniedShell:
		return "已拒绝执行命令" + by + "：命令行未开"
	case DeniedSecret:
		return fmt.Sprintf("已拒绝访问 %s%s：密钥和登录信息不提供", d.Path, by)
	}
	return fmt.Sprintf("已拒绝访问 %s%s：不在可访问的文件夹内", d.Path, by)
}
