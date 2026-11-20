package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kumoSleeping/iridium/internal/version"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

//go:embed assets
var assets embed.FS

// ui is the windowed app: one window on the Iridium shown, a tray icon with the joins' states and
// the app's own controls.
type ui struct {
	app   *application.App
	win   *application.WebviewWindow
	tray  *application.SystemTray
	menu  *application.Menu
	joins *Joins

	mu    sync.Mutex
	ready string // a downloaded update's version, waiting for a restart
}

func gui() int {
	logf := appLog()
	page, _ := fs.Sub(assets, "assets")
	icon, _ := assets.ReadFile("assets/icon.png")
	trayIcon, _ := assets.ReadFile("assets/tray.png")
	u := &ui{}
	u.joins = &Joins{Logf: logf, Changed: func() { application.InvokeAsync(u.redraw) }}
	u.joins.Ask = u.ask
	u.app = application.New(application.Options{
		Name:        "Iridium",
		Description: "Iridium",
		Icon:        icon,
		Assets:      application.AssetOptions{Handler: application.AssetFileServerFS(page)},
		// A second start (the app opened again) shows this one's window.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:               "ltd.kumo.iridium.app",
			OnSecondInstanceLaunch: func(application.SecondInstanceData) { application.InvokeAsync(u.show) },
		},
		Mac:               application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: false},
		Windows:           application.WindowsOptions{DisableQuitOnLastWindowClosed: true},
		Linux:             application.LinuxOptions{DisableQuitOnLastWindowClosed: true, ProgramName: "ir-app"},
		RawMessageHandler: func(w application.Window, msg string, o *application.OriginInfo) { u.message(w, msg, o, logf) },
		OnShutdown:        func() { u.joins.Stop() },
	})

	c, err := loadConfig()
	if err != nil {
		logf("config: %v", err)
	}
	u.win = u.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "main", Title: "Iridium", Width: 1200, Height: 800, MinWidth: 360, MinHeight: 480,
		URL: pageOf(c),
	})
	// Closing the window keeps the app (and this computer joined) in the tray.
	u.win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		e.Cancel()
		u.win.Hide()
	})

	u.menu = u.app.Menu.New()
	u.tray = u.app.SystemTray.New().SetIcon(trayIcon).SetMenu(u.menu)
	u.tray.SetTooltip("Iridium")
	u.tray.OnClick(u.show)
	u.redraw()
	u.joins.Sync(c)
	u.updates(c, logf)

	if err := u.app.Run(); err != nil {
		logf("%v", err)
		return 1
	}
	return 0
}

// pageOf is the window's address: the Iridium shown, else the page that asks for one.
func pageOf(c Config) string {
	if cur := c.current(); cur != "" {
		return cur + "/"
	}
	return "/"
}

func (u *ui) show() {
	u.win.Show()
	u.win.Focus()
}

// message is what a page sends (window._wails.invoke): the address page's address, or from an
// Iridium's own page (its origin one in the list) what the app may do for it. Anything else, from
// any other origin, is dropped: a page is never trusted for what only a person here allows.
func (u *ui) message(w application.Window, msg string, o *application.OriginInfo, logf func(string, ...any)) {
	origin := ""
	if o != nil {
		origin = o.Origin
	}
	logf("message from %q (main frame %v): %.80s", origin, o != nil && o.IsMainFrame, msg)
	c, _ := loadConfig()
	if a, ok := strings.CutPrefix(msg, "ir:add:"); ok && !isServer(c, origin) {
		address, err := normalize(a)
		if err != nil {
			reply(w, map[string]string{"error": "地址无效"})
			return
		}
		c, err = updateConfig(func(c *Config) { c.add(address) })
		if err != nil {
			reply(w, map[string]string{"error": err.Error()})
			return
		}
		u.joins.Sync(c)
		u.redraw()
		u.win.SetURL(address + "/")
		return
	}
	if !isServer(c, origin) {
		return
	}
	switch msg {
	case "ir:hello":
		// The page learns it is in the app, and which: it may show what only the app does.
		reply(w, map[string]any{"app": "ir-app", "version": version.Version})
	}
}

// isServer: is origin (scheme://host[:port]) one of the Iridiums in the list?
func isServer(c Config, origin string) bool {
	if origin == "" {
		return false
	}
	o, err := url.Parse(origin)
	if err != nil {
		return false
	}
	for _, s := range c.Servers {
		if su, err := url.Parse(s.URL); err == nil && su.Scheme == o.Scheme && strings.EqualFold(su.Host, o.Host) {
			return true
		}
	}
	return false
}

// reply hands the page an "ir-app" event with v as its detail.
func reply(w application.Window, v any) {
	b, _ := json.Marshal(v)
	w.ExecJS(fmt.Sprintf(`window.dispatchEvent(new CustomEvent("ir-app",{detail:%s}))`, b))
}

// ask asks the person here, in a dialog of this computer's, never on a page: an Iridium asking
// for more than it was given (docs/exec.md "放开").
func (u *ui) ask(ctx context.Context, q string) bool {
	answer := make(chan bool, 1)
	application.InvokeAsync(func() {
		d := u.app.Dialog.Question().SetTitle("Iridium").SetMessage(q + "。允许？")
		yes := d.AddButton("允许")
		yes.OnClick(func() { answer <- true })
		no := d.AddButton("拒绝")
		no.OnClick(func() { answer <- false })
		d.SetDefaultButton(no)
		d.SetCancelButton(no)
		d.Show()
	})
	select {
	case a := <-answer:
		return a
	case <-ctx.Done():
		return false
	}
}

// redraw builds the tray's menu again: each Iridium with its state, which is shown, the app's own.
func (u *ui) redraw() {
	c, _ := loadConfig()
	m := u.menu
	m.Clear()
	cur := c.current()
	for _, s := range c.Servers {
		host := hostOf(s.URL)
		state := "未接入"
		if !s.Off {
			state = u.joins.Status(s.URL)
		}
		sub := m.AddSubmenu(fmt.Sprintf("%s · %s", host, state))
		show := sub.AddCheckbox("在窗口中显示", s.URL == cur)
		show.OnClick(func(*application.Context) {
			if c, err := updateConfig(func(c *Config) { c.Current = s.URL }); err == nil {
				u.win.SetURL(pageOf(c))
				u.show()
				application.InvokeAsync(u.redraw)
			}
		})
		on := sub.AddCheckbox("接入这台电脑", !s.Off)
		on.OnClick(func(*application.Context) {
			if c, err := updateConfig(func(c *Config) { c.setOff(s.URL, !s.Off) }); err == nil {
				u.joins.Sync(c)
				application.InvokeAsync(u.redraw)
			}
		})
		sub.AddSeparator()
		sub.Add("移除").OnClick(func(*application.Context) {
			if c, err := updateConfig(func(c *Config) { c.remove(s.URL) }); err == nil {
				u.joins.Sync(c)
				u.win.SetURL(pageOf(c))
				application.InvokeAsync(u.redraw)
			}
		})
	}
	m.Add("添加服务器…").OnClick(func(*application.Context) {
		u.win.SetURL("/")
		u.show()
	})
	m.AddSeparator()
	m.Add("打开窗口").OnClick(func(*application.Context) { u.show() })
	if on, err := u.app.Autostart.IsEnabled(); err == nil {
		m.AddCheckbox("登录时打开", on).OnClick(func(*application.Context) {
			if on {
				_ = u.app.Autostart.Disable()
			} else {
				_ = u.app.Autostart.Enable()
			}
			application.InvokeAsync(u.redraw)
		})
	}
	u.mu.Lock()
	ready := u.ready
	u.mu.Unlock()
	if ready != "" {
		m.Add("重启以更新到 " + ready).OnClick(func(*application.Context) {
			if err := u.app.Updater.Restart(context.Background()); err != nil {
				u.app.Dialog.Warning().SetTitle("Iridium").SetMessage("更新失败：" + err.Error()).Show()
			}
		})
	} else {
		m.Add("检查更新").OnClick(func(*application.Context) {
			go func() { _, _ = u.app.Updater.Check(context.Background()) }()
		})
	}
	m.AddSeparator()
	m.Add(fmt.Sprintf("ir-app %s", version.Version)).SetEnabled(false)
	m.Add("退出").OnClick(func(*application.Context) { u.app.Quit() })
	m.Update()
}

// updates: the app's own releases looked for now and every six hours; a newer one is fetched at
// once, and put in place on a restart the person chooses (agents running here end with it).
func (u *ui) updates(c Config, logf func(string, ...any)) {
	src, err := newSource(func() []string { c, _ := loadConfig(); return manifestURLs(c) })
	if err != nil {
		logf("update: %v", err)
		return
	}
	if err := u.app.Updater.Init(updaterConfig(src, 6*time.Hour)); err != nil {
		logf("update: %v", err)
		return
	}
	u.app.Event.On(updater.EventUpdateAvailable, func(*application.CustomEvent) {
		go func() {
			if err := u.app.Updater.DownloadAndInstall(context.Background()); err != nil {
				logf("update: %v", err)
			}
		}()
	})
	u.app.Event.On(updater.EventUpdateReady, func(e *application.CustomEvent) {
		v := ""
		if r, ok := e.Data.(*updater.Release); ok {
			v = r.Version
		}
		logf("update: %s ready", v)
		u.mu.Lock()
		u.ready = v
		u.mu.Unlock()
		application.InvokeAsync(u.redraw)
	})
	u.app.Event.On(updater.EventError, func(e *application.CustomEvent) { logf("update: %v", e.Data) })
	go func() { _, _ = u.app.Updater.Check(context.Background()) }()
}

func hostOf(address string) string {
	if p, err := url.Parse(address); err == nil && p.Host != "" {
		return p.Host
	}
	return address
}

// appLog is the app's log: a file beside its config (no terminal to print to).
func appLog() func(string, ...any) {
	p, err := configPath()
	if err == nil {
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err == nil {
			if f, err := os.OpenFile(filepath.Join(filepath.Dir(p), "app.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
				return log.New(f, "", log.LstdFlags).Printf
			}
		}
	}
	return log.Printf
}
