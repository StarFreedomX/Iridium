package join

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	"github.com/kumoSleeping/iridium/internal/macapp"
	"github.com/kumoSleeping/iridium/internal/remote/executor"
	"github.com/kumoSleeping/iridium/internal/remote/wire"
	"github.com/kumoSleeping/iridium/internal/update"
	"github.com/kumoSleeping/iridium/internal/version"
)

// An executor keeps up with the Iridium it is connected to (the user, 2026-11-17), up only
// (2026-11-23): told a newer version in the hello's answer, it fetches that release from GitHub, or with Proxy through the
// Iridium (<origin>/install/, 2026-11-22), its progress shown, checks it against the release's
// SHA256SUMS, puts it where it runs from (where the install script put it; inside Iridium.app on
// macOS, the bundle signed again), and asks the person at its terminal to restart now (ending
// what it runs) or with the next run. iridium takes the binary out of its release archive;
// ir-computer (cmd/ir-computer, to be removed) fetches its own bare binary from GitHub.

// releases is where the releases are (tests change it).
var releases = joinscript.ReleaseBase

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
	// Up only (kumo, 2026-11-23): this binary is the desktop app too, and an Iridium of an older
	// release took the whole app back with it (v0.2.53 installed, v0.2.52 over it a minute after);
	// joined to several, the newest leads. An older one is spoken to as it is (wire.Protocol).
	if !o.prog().Update || !version.Release() || !version.IsRelease(r.Version) || !update.Newer(r.Version, version.Version) {
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
		o.say("%s 已是 %s（这里 %s），更新 %s", o.where(), r.Version, version.Version, o.selfName())
		if err := o.fetchSelf(ctx, selfExe(), r.Version); err != nil {
			if ctx.Err() == nil {
				o.say("更新失败：%v", err)
			}
			offered.Lock()
			offered.v = ""
			offered.Unlock()
			return
		}
		q := o.selfName() + " " + r.Version + " 已下载，现在重启"
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

// selfName is the program that updates itself: ir-computer (cmd/ir-computer, to be removed with
// it), else iridium.
func (o *Options) selfName() string {
	if o.prog().Self == "ir-computer" {
		return "ir-computer"
	}
	return "iridium"
}

// fetchSelf fetches selfName v for this system from the Iridium into exe (where it runs from),
// its progress shown; it must say it is v.
func (o *Options) fetchSelf(ctx context.Context, exe, v string) error {
	if exe == "" {
		return errors.New("where it runs from is not known")
	}
	name := o.selfName()
	file := joinscript.ArchiveName(runtime.GOOS, runtime.GOARCH)
	if name == "ir-computer" {
		file = "ir-computer-" + runtime.GOOS + "-" + runtime.GOARCH
		if runtime.GOOS == "windows" {
			file += ".exe"
		}
	}
	base := releases(v)
	c := &http.Client{Timeout: 15 * time.Minute}
	if o.Proxy && name != "ir-computer" {
		base = o.URL + joinscript.BinaryPrefix
		if o.HTTP != nil {
			c = &http.Client{Transport: o.HTTP.Transport, Timeout: 15 * time.Minute}
		}
	}
	fetch := func(url string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		resp, err := c.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("%s: %s", url, resp.Status)
		}
		return resp, nil
	}
	sumsResp, err := fetch(base + "SHA256SUMS")
	if err != nil {
		return err
	}
	raw, err := io.ReadAll(io.LimitReader(sumsResp.Body, 1<<20))
	sumsResp.Body.Close()
	if err != nil {
		return err
	}
	want := joinscript.ParseSums(raw)[file]
	if want == "" {
		return fmt.Errorf("%s: not in the release's SHA256SUMS", file)
	}
	resp, err := fetch(base + file)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	tmp := exe + ".new"
	down := tmp
	if name != "ir-computer" {
		down = exe + ".tar.gz"
	}
	f, err := os.OpenFile(down, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer os.Remove(down)
	defer os.Remove(tmp)
	p := &progress{o: o, size: resp.ContentLength, shown: -1}
	sum := sha256.New()
	_, err = io.Copy(io.MultiWriter(f, p, sum), resp.Body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	p.end(err == nil)
	if err != nil {
		return err
	}
	if got := hex.EncodeToString(sum.Sum(nil)); got != want {
		return fmt.Errorf("%s: sha256 %s, SHA256SUMS says %s", file, got, want)
	}
	if down != tmp {
		if err := unpack(down, binaryIn(runtime.GOOS), tmp); err != nil {
			return err
		}
	}
	vctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(vctx, tmp, "version").Output()
	if got := strings.TrimSpace(string(out)); err != nil || got != name+" "+v {
		return fmt.Errorf("the one fetched says %q, not %s %s (%v)", got, name, v, err)
	}
	if err := replaceExe(tmp, exe); err != nil {
		return err
	}
	// Inside Iridium.app (macOS, the install script's): its Info.plist and icon the new release's,
	// the bundle signed again, else macOS takes it for damaged (macapp.Refresh).
	if err := macapp.Refresh(exe, v); err != nil {
		o.say("%s 重新签名失败：%v", macapp.Of(exe), err)
	}
	return nil
}

// binaryIn is the binary's name in iridium's archive for goos (scripts/release.sh).
func binaryIn(goos string) string {
	if goos == "windows" {
		return "iridium.exe"
	}
	return "iridium"
}

// unpack writes the file name of the tar.gz archive at path to dst, executable.
func unpack(path, name, dst string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return fmt.Errorf("no %s in the archive", name)
		}
		if err != nil {
			return err
		}
		if h.Typeflag != tar.TypeReg || strings.TrimPrefix(h.Name, "./") != name {
			continue
		}
		out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755)
		if err != nil {
			return err
		}
		_, err = io.Copy(out, io.LimitReader(tr, 1<<30))
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		return err
	}
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
