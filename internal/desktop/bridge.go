package desktop

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"runtime"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// The pages' side of the app on mygo. An Iridium's page (web/src/irapp.ts) and the app's own
// (web/src/appwin/bridge.ts) speak to the app as they did in Wails: window._wails.invoke("ir:…")
// out, "ir-app" events in. The preload keeps window._wails over mygo's bound method, so pages
// and Iridiums of any version are as they were.

// bridge is the bound service the preload calls (IRApp.Invoke).
type bridge struct {
	u    *ui
	logf func(string, ...any)
}

// Invoke is a page's message: the page and its window are mygo's, from the call; the origin is
// the page's own URL's. mygo has already refused pages it does not trust (the app's own, and each
// window's own Iridium: TrustedOrigins).
func (b *bridge) Invoke(ctx context.Context, msg string) {
	p := mygo.CallerPage(ctx)
	if p == nil || len(msg) > 1<<20 {
		return
	}
	b.u.message(p.Window(), msg, originOf(p.URL()), b.logf)
}

// originOf is scheme://host[:port] of a page's URL; "": none.
func originOf(raw string) string {
	p, err := url.Parse(raw)
	if err != nil || p.Scheme == "" || p.Host == "" {
		return ""
	}
	return p.Scheme + "://" + p.Host
}

// ownPage: is origin the app's own pages' (mygo's frontend: mygo://localhost, or on Windows
// http://mygo.localhost)?
func ownPage(origin string) bool {
	return origin == "mygo://localhost" || origin == "http://mygo.localhost"
}

// shim is the preload of every window: window._wails.invoke over mygo's bound method, messages
// queued till mygo's bridge is there, and the event the pages wait for (wails:runtime-config-ready)
// once the page has loaded. On a Mac the top strip drags the window (Wails gave it as
// InvisibleTitleBarHeight): the page's root is a handle, what is in it is not.
var shim = func() string {
	s := `(function(){
if(window._wails)return;
var q=[];
function flush(){var g=window.mygo;if(!g||!g.call)return false;while(q.length){g.call("IRApp.Invoke",q.shift()).catch(function(){})}return true}
function wait(){if(!flush())setTimeout(wait,50)}
window._wails={invoke:function(m){m=String(m);if(m.indexOf("ir:")!==0)return;q.push(m);wait()}};
function fire(){window.dispatchEvent(new Event("wails:runtime-config-ready"))}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",fire);else fire();
})();`
	if runtime.GOOS == "darwin" {
		s += css("#root{--app-region:drag}#root>*{--app-region:no-drag}")
	}
	return s
}()

// css is JavaScript that puts style in the page as it starts.
func css(style string) string {
	b, _ := json.Marshal(style)
	return `(function(){var s=document.createElement("style");s.textContent=` + string(b) +
		`;(document.head||document.documentElement).appendChild(s)})();`
}

// replies go to the pages in order, one at a time, off the main thread: a page's Eval waits for
// it, and the main thread must not.
var replies struct {
	once sync.Once
	ch   chan func()
}

// reply hands the page an "ir-app" event with v as its detail.
func reply(w *mygo.Window, v any) {
	if w == nil {
		return
	}
	b, _ := json.Marshal(v)
	js := fmt.Sprintf(`window.dispatchEvent(new CustomEvent("ir-app",{detail:%s}))`, b)
	replies.once.Do(func() {
		replies.ch = make(chan func(), 256)
		go func() {
			for f := range replies.ch {
				f()
			}
		}()
	})
	replies.ch <- func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = w.Page().EvalContext(ctx, js)
	}
}

// nameOf is a window's name (picker, ask, w1…); "": not one of the app's.
func (u *ui) nameOf(w *mygo.Window) string {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.names[w]
}

// named records w's name.
func (u *ui) named(w *mygo.Window, name string) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.names == nil {
		u.names = map[*mygo.Window]string{}
	}
	u.names[w] = name
}

// pickFolder asks the person here for one folder, in this computer's own picker.
func pickFolder(title string) (string, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{Title: title, Directory: true, CreateDirectories: true})
	if err != nil || len(paths) == 0 {
		return "", err
	}
	return paths[0], nil
}

// menuBar is the app's menu (see gui): on a Mac the menu bar's, elsewhere each window's, hidden.
func (u *ui) menuBar() *mygo.Menu {
	type item = mygo.MenuItem
	click := func(f func()) func(*mygo.MenuItem, *mygo.Window) {
		return func(*mygo.MenuItem, *mygo.Window) { f() }
	}
	view := []*item{
		{Label: "放大", Accelerator: "CmdOrCtrl+=", Click: click(func() { u.zoom(+1) })},
		{Label: "放大", Accelerator: "CmdOrCtrl+Plus", Hidden: true, Click: click(func() { u.zoom(+1) })},
		{Label: "缩小", Accelerator: "CmdOrCtrl+-", Click: click(func() { u.zoom(-1) })},
		{Label: "实际大小", Accelerator: "CmdOrCtrl+0", Click: click(func() { u.zoom(0) })},
	}
	if runtime.GOOS != "darwin" {
		return mygo.NewMenu([]*item{{Label: "显示", Submenu: view}})
	}
	view = append(view, mygo.Separator(), &item{Role: mygo.RoleToggleFullScreen})
	return mygo.NewMenu([]*item{
		{Label: "Iridium", Submenu: []*item{
			{Role: mygo.RoleAbout}, mygo.Separator(),
			{Label: "设置…", Accelerator: "CmdOrCtrl+,", Click: click(func() { go u.showPicker() })}, mygo.Separator(),
			{Role: mygo.RoleHide}, {Role: mygo.RoleHideOthers}, {Role: mygo.RoleUnhide}, mygo.Separator(),
			{Role: mygo.RoleQuit},
		}},
		{Label: "文件", Submenu: []*item{
			{Label: "打开服务器…", Accelerator: "CmdOrCtrl+N", Click: click(func() { go u.showPicker() })},
			{Role: mygo.RoleClose},
		}},
		{Role: mygo.RoleEditMenu},
		{Label: "显示", Submenu: view},
		{Role: mygo.RoleWindowMenu},
	})
}

// zoom makes the window in front's page larger (+1), smaller (-1) or as it was (0), and keeps it
// for the next start (kumo, 2026-11-20).
func (u *ui) zoom(step int) {
	u.mu.Lock()
	w := u.win
	u.mu.Unlock()
	if w == nil {
		return
	}
	go func() {
		p := w.Page()
		z := p.ZoomFactor()
		switch {
		case step > 0:
			z = min(z+0.1, 3)
		case step < 0:
			z = max(z-0.1, 0.3)
		default:
			z = 1
		}
		p.SetZoomFactor(z)
		_, _ = updateConfig(func(c *Config) { c.Zoom = z })
	}()
}

// pageOptions is a window's page: the shim, and what else is put in it; trusted, besides the app's
// own pages, origin (an Iridium's window: that Iridium).
func pageOptions(origin, extra string, zoom float64) mygo.PageOptions {
	o := mygo.PageOptions{PreloadScript: shim + extra, ZoomFactor: zoom}
	if origin != "" {
		o.TrustedOrigins = []string{origin}
	}
	return o
}

// hideOnClose: w, asked to close, hides (its page keeps its state), unless the app quits.
func (u *ui) hideOnClose(w *mygo.Window) {
	w.OnClose(func(e *mygo.CloseEvent) {
		u.mu.Lock()
		quitting := u.quitting
		u.mu.Unlock()
		if quitting {
			return
		}
		e.PreventDefault()
		go w.Hide()
	})
}
