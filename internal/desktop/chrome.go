package desktop

import (
	"fmt"
	"runtime"
	"strings"
	"unicode/utf8"

	"github.com/egoist/mygo"
)

// The windows' frame (kumo, 2026-11-22): no title bar on any system. The window's keys are drawn
// by the page itself at its top right, its top bar's icon keys (web/src/winkey.tsx, the picker's
// in web/src/appwin); a Mac's own three buttons are hidden. Two keys, no minimise: full screen and
// close. Full screen is each system's own: a Mac's full screen (its green button), Windows'
// maximise (kumo, 2026-11-22). The page's top bar drags the window (chromeJS); on Windows and
// Linux, where the window has no frame of its own, mygo resizes it from its edges.

// bare is o with no title bar: on a Mac a titled window whose bar and buttons are hidden (a
// frameless one misbehaved there: docs/app.md "窗口框架"), elsewhere a frameless one, the
// system's shadow and snapping kept.
func bare(o mygo.WindowOptions) mygo.WindowOptions {
	if runtime.GOOS == "darwin" {
		o.TitleBarStyle = mygo.TitleBarHidden
		o.HideWindowButtons = true
	} else {
		o.Frameless = true
	}
	return o
}

// winKey is a window key pressed in a page: full (a Mac's full screen), max (maximised or back),
// close, reload.
func (u *ui) winKey(w *mygo.Window, key string) {
	if w == nil {
		return
	}
	name := u.nameOf(w)
	switch key {
	case "max":
		w.ToggleMaximize()
	case "full":
		w.ToggleFullScreen()
	case "close":
		if name == "picker" {
			w.Hide()
		} else if name != "ask" {
			w.Close()
		}
	case "reload":
		u.reload(w)
	}
}

// followMax tells w's page whether w is full screen (a Mac) or maximised, as it changes: its key
// is drawn as it is.
func followMax(w *mygo.Window) {
	tell := func() {
		go func() {
			full := w.IsMaximized()
			if runtime.GOOS == "darwin" {
				full = w.IsFullScreen()
			}
			reply(w, map[string]any{"max": full})
		}()
	}
	w.OnMaximize(tell)
	w.OnUnmaximize(tell)
	w.OnRestore(tell)
	w.OnEnterFullScreen(tell)
	w.OnLeaveFullScreen(tell)
}

// reload loads the page in w again (⌘R, Ctrl+R, F5; kumo, 2026-11-22).
func (u *ui) reload(w *mygo.Window) {
	if w != nil && u.nameOf(w) != "ask" {
		go w.Page().Reload()
	}
}

// closePage is ⌘W, Ctrl+W (kumo, 2026-11-22): the page in front shut, not the window; only from
// the page's first one (nothing open) the window. The page says which (appkey.tsx closePage); one
// that cannot, an Iridium from before, has its window closed.
func (u *ui) closePage(w *mygo.Window) {
	if w == nil {
		return
	}
	switch u.nameOf(w) {
	case "picker":
		go w.Hide()
		return
	case "ask", "":
		return
	}
	go func() {
		_, _ = w.Page().Eval(`if(window.__irClosePage){window.__irClosePage()}else{window._wails.invoke("ir:win:close")}`)
	}()
}

// retitle names address's windows here (Server.Title; "": Iridium), the app's own name for it.
func (u *ui) retitle(address, title string) {
	title = strings.TrimSpace(strings.Join(strings.Fields(title), " "))
	if utf8.RuneCountInString(title) > 40 {
		title = string([]rune(title)[:40])
	}
	if _, err := updateConfig(func(c *Config) {
		if s := c.server(address); s != nil {
			s.Title = title
		}
	}); err != nil {
		return
	}
	u.mu.Lock()
	var ws []*mygo.Window
	for _, w := range u.wins {
		if u.shows[u.names[w]] == address {
			ws = append(ws, w)
		}
	}
	u.mu.Unlock()
	for _, w := range ws {
		w.SetTitle(windowTitle(title))
	}
	u.redraw()
}

// windowTitle is a window's title: its Iridium's name here, else Iridium.
func windowTitle(title string) string {
	if title == "" {
		return "Iridium"
	}
	return title
}

// chromeJS is put in every page a window shows: its top bar drags the window (mygo's --app-region;
// a double click there does as the system's title bar does). The top bar is what the page marks
// data-app-drag (the keys, fields and links in it excepted); a page with none marked (an Iridium
// from before) has its top 40 pixels, marked for mygo as the pointer goes down there. Such a page
// draws no window keys either: they are put at its top right here, plainer, till the page has its
// own (data-win-keys).
var chromeJS = css(`[data-app-drag]{--app-region:drag}`) + fmt.Sprintf(`(function(){
var mac=%t;
function inv(m){var w=window._wails;if(w&&w.invoke)w.invoke(m)}
var keys="button,a,input,textarea,select,label,summary,[role=button],[role=menuitem],[role=tab],[role=switch],[contenteditable=true],[contenteditable=''],[data-no-drag]";
addEventListener("pointerdown",function(e){var t=e.target;if(e.button!==0||!(t instanceof Element)||t.closest(keys))return;
if(document.querySelector("[data-app-drag]")||e.clientY>=40)return;
t.style.setProperty("--app-region","drag");setTimeout(function(){t.style.removeProperty("--app-region")},0)},true);
function plain(){var have=document.querySelector("[data-win-keys]:not([data-win-keys=app])"),ours=document.querySelector("[data-win-keys=app]");
if(have){if(ours)ours.remove();return}if(ours||!document.body)return;
var d=document.createElement("div");d.setAttribute("data-win-keys","app");
d.style.cssText="position:fixed;top:8px;right:8px;z-index:2147483647;display:flex;gap:2px";
[[mac?"full":"max",mac?"⤢":"□"],["close","✕"]].forEach(function(k){var b=document.createElement("button");b.type="button";b.setAttribute("aria-label",k[0]);b.textContent=k[1];
b.style.cssText="width:32px;height:32px;border-radius:6px;border:0;padding:0;cursor:default;background:none;color:inherit;opacity:.7;font:15px system-ui";b.onclick=function(){inv("ir:win:"+k[0])};d.appendChild(b)});
document.body.appendChild(d)}
setInterval(plain,2000);
})();
`, runtime.GOOS == "darwin")
