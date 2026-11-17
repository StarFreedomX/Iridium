package join

import (
	"bufio"
	"context"
	"os"
	"runtime"
	"strings"
	"sync"

	"github.com/kumoSleeping/iridium/internal/remote/executor"
)

// What the person at the terminal reads of what it may do, and of what it turned down; and what
// the Iridium's page asks of it (a grant), allowed there (docs/exec.md "放开").

// grants is what it may do now, as the person reads it: the folders, whether command lines run.
func (o *Options) grants(ex *executor.Executor) string {
	shell := "命令行未开"
	if ex.Shell() {
		shell = "命令行已开"
	}
	roots := ex.Roots()
	for i, r := range roots {
		roots[i] = o.tilde(r)
	}
	where := "全部文件夹"
	if len(roots) > 0 {
		where = strings.Join(roots, "、")
	}
	return "可访问 " + where + "；" + shell
}

// tilde is path with the home directory as ~.
func (o *Options) tilde(path string) string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return path
	}
	if path == home {
		return "~"
	}
	if rest, ok := strings.CutPrefix(path, home+string(os.PathSeparator)); ok {
		return "~" + string(os.PathSeparator) + rest
	}
	return path
}

// denied tells the person of what was turned down; the first time, how it is allowed.
func (o *Options) denied(d executor.Denial) {
	if d.Path != "" {
		d.Path = o.tilde(d.Path)
	}
	o.say("%s", d)
	if d.What == executor.DeniedSecret {
		return
	}
	term.hintOnce.Do(func() {
		o.say("  放开：在 %s 的会话卡片或应用管理里点“放开”，再在此窗口确认", o.where())
	})
}

// ask is the question asker for grants: the terminal's (its tty), nil when there is none.
func (o *Options) ask() func(context.Context, string) bool {
	if o.Ask != nil {
		return o.Ask
	}
	term.ttyOnce.Do(func() {
		name := "/dev/tty"
		if runtime.GOOS == "windows" {
			name = "CONIN$"
		}
		f, err := os.Open(name)
		if err != nil {
			return
		}
		lines := make(chan string)
		go func() {
			sc := bufio.NewScanner(f)
			for sc.Scan() {
				lines <- sc.Text()
			}
			close(lines)
		}()
		term.tty = lines
	})
	if term.tty == nil {
		return nil
	}
	return func(ctx context.Context, q string) bool {
		// What was typed before the question is not its answer.
		for drained := false; !drained; {
			select {
			case _, ok := <-term.tty:
				if !ok {
					return false
				}
			default:
				drained = true
			}
		}
		o.say("\a%s。允许？[y/N]", q)
		var line string
		var ok bool
		select {
		case line, ok = <-term.tty:
		case <-ctx.Done():
			o.say("未回答，按拒绝处理")
			return false
		}
		yes := ok && (strings.EqualFold(strings.TrimSpace(line), "y") || strings.EqualFold(strings.TrimSpace(line), "yes"))
		if yes {
			o.say("已允许")
		} else {
			o.say("已拒绝")
		}
		return yes
	}
}

// term is the terminal's lines, read once for every question, and whether the hint was said: one
// terminal to a process.
var term struct {
	ttyOnce  sync.Once
	tty      chan string
	hintOnce sync.Once
}
