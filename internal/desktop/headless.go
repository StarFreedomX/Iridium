package desktop

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// headless runs the joins alone, for a computer with no screen (a server): the addresses given,
// else the app's own list. What an Iridium may do here is what the options (or the app's config)
// say; a grant it asks for is asked at the terminal it runs in, and with none (a service) turned
// down: there is no one here to ask, and the Iridium never decides for this computer.
func headless(args []string) int {
	fs := flag.NewFlagSet("iridium headless", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	name := fs.String("name", "", "")
	roots := fs.String("roots", "", "")
	noShell := fs.Bool("no-shell", false, "")
	var pos []string
	for {
		if err := fs.Parse(args); err != nil {
			fmt.Fprintf(os.Stderr, "iridium: %v\n\n%s", err, usage)
			return 2
		}
		if fs.NArg() == 0 {
			break
		}
		pos, args = append(pos, fs.Arg(0)), fs.Args()[1:]
	}
	c, err := loadConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "iridium: %v\n", err)
		return 1
	}
	if len(pos) > 0 {
		c.Servers = nil
		for _, p := range pos {
			a, err := normalize(p)
			if err != nil {
				fmt.Fprintf(os.Stderr, "iridium: %v\n", err)
				return 2
			}
			c.Servers = append(c.Servers, Server{URL: a})
		}
	}
	if len(c.Servers) == 0 {
		fmt.Fprint(os.Stderr, "iridium: no Iridium to join: give its address\n\n"+usage)
		return 2
	}
	if *name != "" {
		c.Name = *name
	}
	var dirs []string
	for _, r := range strings.Split(*roots, ",") {
		if r = strings.TrimSpace(r); r != "" {
			abs, err := filepath.Abs(r)
			if err != nil {
				fmt.Fprintf(os.Stderr, "iridium: %v\n", err)
				return 2
			}
			dirs = append(dirs, abs)
		}
	}
	// The options are the terms for every Iridium it joins.
	for i := range c.Servers {
		c.Servers[i].Off = false
		if *noShell {
			c.Servers[i].NoShell = true
		}
		if dirs != nil {
			c.Servers[i].Roots = dirs
		}
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	defer stop()
	logf := func(f string, a ...any) { fmt.Fprintf(os.Stderr, time.Now().Format("15:04:05 ")+f+"\n", a...) }
	j := &Joins{Terminal: true, Logf: logf}
	j.Sync(c)
	go headlessUpdates(ctx, c, logf)
	<-ctx.Done()
	j.Stop()
	return 0
}

// headlessUpdates: the app's own releases looked for every six hours; a newer one is fetched,
// checked and put in place of this program, taking effect at its next start (the service
// restarted, the computer rebooted). Not restarted here: the agents running would end with it.
func headlessUpdates(ctx context.Context, c Config, logf func(string, ...any)) {
	src, err := newSource(func() []string { return manifestURLs(c) })
	if err != nil {
		logf("update: %v", err)
		return
	}
	u := updater.New(quietHost{})
	if err := u.Init(updaterConfig(src, 0)); err != nil {
		logf("update: %v", err)
		return
	}
	for {
		if r, err := u.Check(ctx); err != nil {
			logf("update: %v", err)
		} else if r != nil {
			if err := u.DownloadAndInstall(ctx); err != nil {
				logf("update: %v", err)
			} else if err := replaceSelf(u.DownloadedPath()); err != nil {
				logf("update: %v", err)
			} else {
				// The updater's staging directory, beside the program: not needed once it is in place.
				if d := filepath.Dir(u.DownloadedPath()); strings.HasPrefix(filepath.Base(d), "wails-update-") {
					_ = os.RemoveAll(d)
				}
				logf("ir-app %s 已就绪，下次启动时生效", r.Version)
				return
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(6 * time.Hour):
		}
	}
}

// replaceSelf puts the program at staged in place of this one's file (the running one keeps its
// own till it ends). On Windows the running file is moved aside first, as it may not be replaced.
func replaceSelf(staged string) error {
	if staged == "" {
		return errors.New("nothing downloaded")
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if r, err := filepath.EvalSymlinks(self); err == nil {
		self = r
	}
	if fi, err := os.Stat(staged); err != nil || fi.IsDir() {
		return fmt.Errorf("the download is not a program: %s", staged)
	}
	b, err := os.ReadFile(staged)
	if err != nil {
		return err
	}
	tmp := self + ".new"
	if err := os.WriteFile(tmp, b, 0o755); err != nil {
		return err
	}
	if isWindows {
		_ = os.Remove(self + ".old")
		if err := os.Rename(self, self+".old"); err != nil {
			return err
		}
	}
	return os.Rename(tmp, self)
}

// quietHost is the updater's host with no window: nothing shown, nothing to quit.
type quietHost struct{}

func (quietHost) Emit(string, ...any) bool                              { return true }
func (quietHost) OnEvent(string, func(any)) func()                      { return func() {} }
func (quietHost) OpenWindow(updater.WindowOptions) updater.WindowHandle { return noWindow{} }
func (quietHost) Quit()                                                 {}

type noWindow struct{}

func (noWindow) EmitEvent(string, ...any) bool { return true }
func (noWindow) Show()                         {}
func (noWindow) Close()                        {}
