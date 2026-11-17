package join

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/kumoSleeping/iridium/internal/joinscript"
	"github.com/kumoSleeping/iridium/internal/remote/executor"
	"github.com/kumoSleeping/iridium/internal/remote/wire"
	"github.com/kumoSleeping/iridium/internal/version"
)

// ir-computer keeps up with the Iridium it is connected to (the user, 2026-11-17): told another
// version in the hello's answer, it fetches that one from the Iridium (<origin>/join/, its progress
// shown), puts it where it runs from, and asks the person at its terminal to restart now (ending
// what it runs) or with the next run.

// ErrRestart: the person allowed a restart into the new version (Program.Main runs it).
var ErrRestart = errors.New("restart into the new version")

// offered is the version fetched or being fetched in this process: each once.
var offered struct {
	sync.Mutex
	v string
}

// newer looks at the hello's answer r: another release than this one's, it fetches it and asks to
// restart (restart, said yes).
func (o *Options) newer(ctx context.Context, ex *executor.Executor, r wire.HelloReply, restart func()) {
	if !o.prog().Update || !version.Release() || !version.IsRelease(r.Version) || strings.TrimPrefix(r.Version, "v") == strings.TrimPrefix(version.Version, "v") {
		return
	}
	offered.Lock()
	if offered.v == r.Version {
		offered.Unlock()
		return
	}
	offered.v = r.Version
	offered.Unlock()
	go func() {
		o.say("%s 已是 %s（这里 %s），更新 ir-computer", o.where(), r.Version, version.Version)
		if err := o.fetchSelf(ctx, selfExe(), r.Version); err != nil {
			if ctx.Err() == nil {
				o.say("更新失败：%v", err)
			}
			offered.Lock()
			offered.v = ""
			offered.Unlock()
			return
		}
		q := "ir-computer " + r.Version + " 已下载，现在重启"
		if n := ex.Busy(); n > 0 {
			q += fmt.Sprintf("（结束这里正在运行的 %d 个进程）", n)
		}
		if ask := o.ask(); ask != nil && ask(ctx, q) {
			restart()
			return
		}
		if ctx.Err() == nil {
			o.say("下次运行时生效")
		}
	}()
}

// fetchSelf fetches ir-computer v for this system from the Iridium into exe (where it runs from),
// its progress shown; it must say it is v.
func (o *Options) fetchSelf(ctx context.Context, exe, v string) error {
	if exe == "" {
		return errors.New("where it runs from is not known")
	}
	url := o.URL + joinscript.BinaryPrefix + joinscript.BinaryName(runtime.GOOS, runtime.GOARCH)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	c := &http.Client{Timeout: 15 * time.Minute}
	if o.HTTP != nil {
		c = &http.Client{Transport: o.HTTP.Transport, Timeout: 15 * time.Minute}
	}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: %s", url, resp.Status)
	}
	tmp := exe + ".new"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer os.Remove(tmp)
	p := &progress{o: o, size: resp.ContentLength, shown: -1}
	_, err = io.Copy(io.MultiWriter(f, p), resp.Body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	p.end(err == nil)
	if err != nil {
		return err
	}
	vctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(vctx, tmp, "version").Output()
	if got := strings.TrimSpace(string(out)); err != nil || got != "ir-computer "+v {
		return fmt.Errorf("the one fetched says %q, not ir-computer %s (%v)", got, v, err)
	}
	return replaceExe(tmp, exe)
}

// replaceExe puts the file at tmp in place of exe, which runs.
func replaceExe(tmp, exe string) error {
	if runtime.GOOS == "windows" {
		// A running .exe cannot be replaced, only renamed.
		old := exe + ".old"
		_ = os.Remove(old)
		if err := os.Rename(exe, old); err != nil {
			return err
		}
	}
	return os.Rename(tmp, exe)
}

// progress shows a download's progress on one line: 下载中 37%.
type progress struct {
	o     *Options
	size  int64
	done  int64
	shown int
}

func (p *progress) Write(b []byte) (int, error) {
	p.done += int64(len(b))
	if p.size > 0 {
		if pct := int(p.done * 100 / p.size); pct != p.shown {
			p.shown = pct
			p.print(fmt.Sprintf("\r下载中 %d%%", pct))
		}
	} else if mb := int(p.done >> 20); mb != p.shown {
		p.shown = mb
		p.print(fmt.Sprintf("\r下载中 %d MB", mb))
	}
	return len(b), nil
}

func (p *progress) end(ok bool) {
	if !ok {
		p.print("\n")
		return
	}
	p.print(fmt.Sprintf("\r下载完成 %.1f MB\n", float64(p.done)/(1<<20)))
}

func (p *progress) print(s string) {
	if p.o.Out != nil {
		fmt.Fprint(p.o.Out, s)
	}
}
