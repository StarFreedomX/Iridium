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
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/kumoSleeping/iridium/internal/join"
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
	loginEnv(logf)
	// The app's own pages: web/src/appwin, built into assets/ui (npm run build:app).
	page, _ := fs.Sub(assets, "assets/ui")
	icon, _ := assets.ReadFile("assets/icon.png")
	trayIcon, _ := assets.ReadFile("assets/tray.png")
	u := &ui{}
	u.joins = &Joins{Logf: logf, Changed: func() { application.InvokeAsync(u.redraw) }}
	u.joins.Ask = u.ask
	u.joins.AskEach = u.askEach
	u.joins.Widened = func(server string, shell bool, roots, off []string) {
		_, _ = updateConfig(func(c *Config) {
			if s := c.server(server); s != nil {
				s.NoShell, s.Roots, s.AgentsOff = !shell, roots, off
			}
		})
		application.InvokeAsync(u.redraw)
	}
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

	// macOS gives a web view ⌘C, ⌘V, ⌘A, ⌘Z only through the menu bar's Edit menu: without one,
	// nothing pastes. Elsewhere the keys work without, and a menu would be a bar in the window.
	if runtime.GOOS == "darwin" {
		bar := u.app.Menu.New()
		bar.AddRole(application.AppMenu)
		bar.AddRole(application.EditMenu)
		bar.AddRole(application.WindowMenu)
		u.app.Menu.SetApplicationMenu(bar)
	}

	u.menu = u.app.Menu.New()
	u.tray = u.app.SystemTray.New().SetIcon(trayIcon).SetMenu(u.menu)
	if runtime.GOOS == "darwin" {
		// The menu bar's own kind of icon: the mark's shape alone, the bar tinting it, at its size
		// (kumo, 2026-11-20: the coloured one stood out too large).
		mark, _ := assets.ReadFile("assets/tray-mac.png")
		u.tray.SetTemplateIcon(mark)
	}
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

// pageOf is the window's address: the Iridium shown once logged in to, else the app's own login
// page (assets/index.html).
func pageOf(c Config) string {
	if s := c.server(c.current()); s != nil && s.LoggedIn {
		return s.URL + "/"
	}
	return "/"
}

func (u *ui) show() {
	u.win.Show()
	u.win.Focus()
}

// message is what a page sends (window._wails.invoke). The address page (the app's own) adds an
// Iridium; an Iridium's own page (its origin one in the list) may ask what the app is, switch to
// another in the list, add one (with a dialog of this computer's: joining is this computer's
// to allow), and log in from the browser. Anything else, from any other origin, is dropped: a
// page is never trusted for what only a person here allows.
func (u *ui) message(w application.Window, msg string, o *application.OriginInfo, logf func(string, ...any)) {
	origin := ""
	if o != nil {
		origin = o.Origin
	}
	c, _ := loadConfig()
	server := serverOf(c, origin)
	verb, arg, _ := strings.Cut(strings.TrimPrefix(msg, "ir:"), ":")
	if !strings.HasPrefix(msg, "ir:") {
		return
	}
	logf("message %s from %q", verb, origin)
	if server == "" {
		// Not an Iridium's page: the app's own login page (assets), or nothing.
		if strings.HasPrefix(origin, "wails:") || strings.HasPrefix(origin, "http://wails.localhost") {
			u.local(w, verb, arg)
		}
		return
	}
	switch verb {
	case "me":
		// Who the window is there, for the app's own page.
		var me struct{ Name, Avatar string }
		if json.Unmarshal([]byte(arg), &me) == nil && len(me.Avatar) < 512<<10 && (me.Avatar == "" || strings.HasPrefix(me.Avatar, "data:image/")) {
			_, _ = updateConfig(func(c *Config) {
				if s := c.server(server); s != nil {
					s.LoggedIn, s.Name, s.Avatar = true, me.Name, me.Avatar
				}
			})
		}
	case "home":
		// The app's own page, with the Iridiums in its list.
		u.win.SetURL("/")
	case "needlogin":
		// The Iridium's login page, in the app: the app's own instead (its passkey is in the browser).
		if _, err := updateConfig(func(c *Config) { c.Current = server; c.server(server).LoggedIn = false }); err == nil {
			u.win.SetURL("/")
		}
	case "hello":
		reply(w, u.hello(c, server))
	case "switch":
		for _, s := range c.Servers {
			if s.URL == arg {
				u.switchTo(arg)
			}
		}
	case "add":
		go u.add(w, arg, true)
	case "remove":
		if arg == server {
			return // not the one the page is on: from another's
		}
		if c, err := updateConfig(func(c *Config) { c.remove(arg) }); err == nil {
			u.joins.Sync(c)
			application.InvokeAsync(u.redraw)
			reply(w, u.hello(c, server))
		}
	case "set":
		go u.set(w, server, arg)
	case "pickroot":
		to := server
		if arg != "" && c.server(arg) != nil {
			to = arg
		}
		go u.pickRoot(w, to, server)
	case "autostart":
		if arg == "on" {
			_ = u.app.Autostart.Enable()
		} else {
			_ = u.app.Autostart.Disable()
		}
		application.InvokeAsync(u.redraw)
		reply(w, u.hello(c, server))
	case "update":
		if arg == "restart" {
			_ = u.app.Updater.Restart(context.Background())
			return
		}
		go func() {
			_, err := u.app.Updater.Check(context.Background())
			c, _ := loadConfig()
			h := u.hello(c, server)
			if err != nil {
				h["error"] = "检查更新失败"
			} else if h["update"] == "" {
				h["notice"] = "已是最新"
			}
			reply(w, h)
		}()
	}
}

// local answers the app's own page (web/src/appwin): the Iridiums in the list, with who the
// window is at those logged in to; opening one, logging in to one from the browser (an address
// typed is checked to be an Iridium and put in the list first), removing one.
func (u *ui) local(w application.Window, verb, arg string) {
	state := func(c Config) map[string]any {
		list := []map[string]any{}
		for _, s := range c.Servers {
			list = append(list, map[string]any{"url": s.URL, "host": hostOf(s.URL), "loggedIn": s.LoggedIn, "name": s.Name, "avatar": s.Avatar})
		}
		return map[string]any{"servers": list, "current": c.current()}
	}
	switch verb {
	case "askstate":
		reply(w, askState())
	case "answer":
		answerAsk(arg)
	case "clipboard":
		// Its text field's ⌘V (web/src/appwin/bridge.ts): this page only, the app's own.
		text, _ := u.app.Clipboard.Text()
		reply(w, map[string]string{"clipboard": text})
	case "copy":
		u.app.Clipboard.SetText(arg)
	case "hello":
		c, _ := loadConfig()
		reply(w, state(c))
	case "open":
		if c, _ := loadConfig(); c.server(arg) != nil {
			u.switchTo(arg)
		}
	case "remove":
		if c, err := updateConfig(func(c *Config) { c.remove(arg) }); err == nil {
			u.joins.Sync(c)
			application.InvokeAsync(u.redraw)
			reply(w, state(c))
		}
	case "login":
		go func() {
			a, err := normalize(arg)
			if err != nil {
				reply(w, map[string]string{"error": "地址无效"})
				return
			}
			c, _ := loadConfig()
			if c.server(a) == nil {
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				err := isIridium(ctx, a)
				cancel()
				if err != nil {
					reply(w, map[string]string{"error": err.Error()})
					return
				}
				// Typed here by the person: in the list, and this computer joined to it.
				if c, err = updateConfig(func(c *Config) { c.add(a) }); err != nil {
					reply(w, map[string]string{"error": err.Error()})
					return
				}
				u.joins.Sync(c)
				application.InvokeAsync(u.redraw)
				st := state(c)
				st["added"] = true
				reply(w, st)
			}
			name := c.Name
			if name == "" {
				name = join.MachineName()
			}
			browserLogin(a, name, u.app.Browser.OpenURL, func(m map[string]string) {
				m["server"] = a
				reply(w, m)
			}, func(link, who string) {
				_, _ = updateConfig(func(c *Config) {
					if s := c.server(a); s != nil {
						s.LoggedIn = true
						if who != "" {
							s.Name = who
						}
					}
					c.Current = a
				})
				application.InvokeAsync(u.redraw)
				u.win.SetURL(link)
				u.show()
			})
		}()
	}
}

// hello is what an Iridium's page learns of the app: that it is in it, and the Iridiums in its
// list (the window's switcher, which the page draws in its top bar).
func (u *ui) hello(c Config, server string) map[string]any {
	name := c.Name
	if name == "" {
		name = join.MachineName()
	}
	// Each Iridium in the list, with this computer as joined to it: its state, what it may do here.
	list := []map[string]any{}
	for _, s := range c.Servers {
		agents := []map[string]any{}
		for _, a := range u.joins.Agents() {
			agents = append(agents, map[string]any{"name": a.Agent, "on": !slices.Contains(s.AgentsOff, a.Agent)})
		}
		status := "未接入"
		if !s.Off {
			status = brief(u.joins.Status(s.URL))
		}
		roots := s.Roots
		if roots == nil {
			roots = []string{}
		}
		list = append(list, map[string]any{"url": s.URL, "host": hostOf(s.URL), "current": s.URL == server,
			"joined": !s.Off, "status": status, "shell": !s.NoShell, "roots": roots, "agents": agents})
	}
	auto, _ := u.app.Autostart.IsEnabled()
	u.mu.Lock()
	ready := u.ready
	u.mu.Unlock()
	return map[string]any{"app": "ir-app", "version": version.Version, "name": name, "servers": list, "autostart": auto, "update": ready}
}

// terms are what a page may ask to change of this computer for its Iridium: narrowing is done at
// once; widening (joining it, command lines on, a folder more) only once the person here allows it
// in a dialog of this computer's.
type terms struct {
	URL    string `json:"url"` // the Iridium they are for; "": the page's own
	Joined *bool  `json:"joined"`
	// Agents: each named turned on or off.
	Agents map[string]bool `json:"agents"`
	Shell  *bool           `json:"shell"`
	Roots  []string        `json:"roots"` // the folders kept: only fewer (a folder more is pickroot's)
	All    bool            `json:"all"`   // every folder again
}

func (u *ui) set(w application.Window, server, arg string) {
	var t terms
	if json.Unmarshal([]byte(arg), &t) != nil {
		return
	}
	page := server
	if t.URL != "" {
		server = t.URL
	}
	c, _ := loadConfig()
	s := c.server(server)
	if s == nil {
		return
	}
	var wider []string
	for a, on := range t.Agents {
		if on && slices.Contains(s.AgentsOff, a) {
			wider = append(wider, "允许 "+hostOf(server)+" 在这台电脑上启动 "+a)
		}
	}
	if t.Joined != nil && *t.Joined && s.Off {
		wider = append(wider, "让这台电脑接入 "+hostOf(server))
	}
	if t.Shell != nil && *t.Shell && s.NoShell {
		wider = append(wider, "允许 "+hostOf(server)+" 在这台电脑上执行命令")
	}
	if t.All && len(s.Roots) > 0 {
		wider = append(wider, "允许 "+hostOf(server)+" 访问这台电脑的全部文件夹")
	}
	if t.Roots != nil {
		// Only folders it had: a page cannot name a new one.
		for _, r := range t.Roots {
			if !slices.Contains(s.Roots, r) {
				return
			}
		}
		if len(s.Roots) > 0 && len(t.Roots) == 0 {
			return // none left would be all: that is no narrowing
		}
	}
	if len(wider) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		ok := u.confirm(ctx, strings.Join(wider, "；")+"？")
		cancel()
		if !ok {
			reply(w, u.hello(c, page))
			return
		}
	}
	c, err := updateConfig(func(c *Config) {
		s := c.server(server)
		if s == nil {
			return
		}
		if t.Joined != nil {
			s.Off = !*t.Joined
		}
		if t.Shell != nil {
			s.NoShell = !*t.Shell
		}
		if t.Roots != nil {
			s.Roots = t.Roots
		}
		if t.All {
			s.Roots = nil
		}
		for a, on := range t.Agents {
			s.AgentsOff = slices.DeleteFunc(s.AgentsOff, func(x string) bool { return x == a })
			if !on {
				s.AgentsOff = append(s.AgentsOff, a)
			}
		}
	})
	if err != nil {
		return
	}
	u.joins.Sync(c)
	application.InvokeAsync(u.redraw)
	reply(w, u.hello(c, page))
}

// pickRoot: a folder for server, chosen by the person here in this computer's own picker (the
// choosing is the allowing): one more, or, with all of them open, the only one from now on.
func (u *ui) pickRoot(w application.Window, server, page string) {
	dir, err := u.app.Dialog.OpenFile().CanChooseDirectories(true).CanChooseFiles(false).
		SetTitle("允许 " + hostOf(server) + " 访问的文件夹").PromptForSingleSelection()
	if err != nil || dir == "" {
		return
	}
	c, err := updateConfig(func(c *Config) {
		if s := c.server(server); s != nil && !slices.Contains(s.Roots, dir) {
			s.Roots = append(s.Roots, dir)
		}
	})
	if err != nil {
		return
	}
	u.joins.Sync(c)
	reply(w, u.hello(c, page))
}

// add checks that address is an Iridium, then (asked by a page, with this computer's dialog)
// puts it in the list, joins it and shows it.
func (u *ui) add(w application.Window, address string, ask bool) {
	a, err := normalize(address)
	if err != nil {
		reply(w, map[string]string{"error": "地址无效"})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := isIridium(ctx, a); err != nil {
		reply(w, map[string]string{"error": err.Error()})
		return
	}
	if ask && !u.confirm(ctx, fmt.Sprintf("添加 %s，并让这台电脑接入它？", hostOf(a))) {
		reply(w, map[string]string{"error": "已取消"})
		return
	}
	c, err := updateConfig(func(c *Config) { c.add(a) })
	if err != nil {
		reply(w, map[string]string{"error": err.Error()})
		return
	}
	u.joins.Sync(c)
	application.InvokeAsync(u.redraw)
	u.win.SetURL(pageOf(c))
}

func (u *ui) switchTo(address string) {
	if c, err := updateConfig(func(c *Config) { c.Current = address }); err == nil {
		u.win.SetURL(pageOf(c))
		application.InvokeAsync(u.redraw)
	}
}

// serverOf is the Iridium in the list whose origin (scheme://host[:port]) origin is; "": none.
func serverOf(c Config, origin string) string {
	if origin == "" {
		return ""
	}
	o, err := url.Parse(origin)
	if err != nil {
		return ""
	}
	for _, s := range c.Servers {
		if su, err := url.Parse(s.URL); err == nil && su.Scheme == o.Scheme && strings.EqualFold(su.Host, o.Host) {
			return s.URL
		}
	}
	return ""
}

func isServer(c Config, origin string) bool { return serverOf(c, origin) != "" }

// reply hands the page an "ir-app" event with v as its detail.
func reply(w application.Window, v any) {
	b, _ := json.Marshal(v)
	w.ExecJS(fmt.Sprintf(`window.dispatchEvent(new CustomEvent("ir-app",{detail:%s}))`, b))
}

// ask asks the person here, in a dialog of this computer's, never on a page: an Iridium asking
// for more than it was given (docs/exec.md "放开").
func (u *ui) ask(ctx context.Context, q string) bool { return u.confirm(ctx, q+"。允许？") }

// confirm is a question to the person here, in a dialog of this computer's: allowed or not.
func (u *ui) confirm(ctx context.Context, q string) bool {
	answer := make(chan bool, 1)
	application.InvokeAsync(func() {
		d := u.app.Dialog.Question().SetTitle("Iridium").SetMessage(q)
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
			state = brief(u.joins.Status(s.URL))
		}
		sub := m.AddSubmenu(fmt.Sprintf("%s · %s", host, state))
		show := sub.AddCheckbox("在窗口中显示", s.URL == cur)
		show.OnClick(func(*application.Context) {
			u.switchTo(s.URL)
			u.show()
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

// brief is a join's last word as the tray's menu says it: a state, short; the whole line is in
// the log.
func brief(line string) string {
	switch {
	case line == "":
		return "连接中"
	case strings.HasPrefix(line, "已连接"), strings.HasPrefix(line, "可访问"):
		return "已连接"
	case strings.HasPrefix(line, "配对码"):
		code, _, _ := strings.Cut(strings.TrimPrefix(line, "配对码 "), "：")
		return "配对码 " + code
	case strings.Contains(line, "runs here"):
		return "已由其他程序接入"
	case strings.HasPrefix(line, "连接中"), strings.HasPrefix(line, "已断开"):
		return line
	case strings.Contains(line, "没开配对"):
		return "未开配对"
	}
	if r := []rune(line); len(r) > 16 {
		return string(r[:16]) + "…"
	}
	return line
}
