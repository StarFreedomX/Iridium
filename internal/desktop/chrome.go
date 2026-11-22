package desktop

import (
	"fmt"
	"runtime"
	"strings"
	"unicode/utf8"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// The windows' frame (kumo, 2026-11-22): no title bar on any system. The three keys (minimise,
// maximise, close) are drawn by the page itself at its top right, one look on a Mac and on
// Windows (web/src/appkey.tsx WinKeys, the picker's in web/src/appwin); a Mac's own three buttons
// are hidden. The page's top bar drags the window (chromeJS); on Windows and Linux, where the
// window has no frame of its own, its edges resize it.

// bare is o with no title bar: on a Mac a titled window whose bar and buttons are hidden (a
// frameless one misbehaved there: docs/app.md "窗口框架"), elsewhere a frameless one, the
// system's shadow and snapping kept.
func bare(o application.WebviewWindowOptions) application.WebviewWindowOptions {
	if runtime.GOOS == "darwin" {
		o.Mac = application.MacWindow{TitleBar: application.MacTitleBarHidden}
		o.MinimiseButtonState = application.ButtonHidden
		o.MaximiseButtonState = application.ButtonHidden
		o.CloseButtonState = application.ButtonHidden
	} else {
		o.Frameless = true
	}
	return o
}

// winKey is a window key pressed in a page: min, max (maximised or back), close, reload.
func (u *ui) winKey(w application.Window, key string) {
	ww, ok := w.(*application.WebviewWindow)
	if !ok {
		return
	}
	switch key {
	case "min":
		ww.Minimise()
	case "max":
		ww.ToggleMaximise()
	case "close":
		if ww == u.picker {
			ww.Hide()
		} else if ww.Name() != "ask" {
			ww.Close()
		}
	case "reload":
		u.reload(ww)
	}
}

// followMax tells w's page whether w is maximised, as it changes: its key is drawn as it is.
func followMax(w *application.WebviewWindow) {
	tell := func(*application.WindowEvent) {
		go reply(w, map[string]any{"max": w.IsMaximised()})
	}
	for _, e := range []events.WindowEventType{events.Common.WindowMaximise, events.Common.WindowUnMaximise, events.Common.WindowRestore} {
		w.OnWindowEvent(e, tell)
	}
}

// reload loads the page in w again (⌘R, Ctrl+R, F5; kumo, 2026-11-22).
func (u *ui) reload(w application.Window) {
	if ww, ok := w.(*application.WebviewWindow); ok && ww.Name() != "ask" {
		ww.Reload()
	}
}

// closePage is ⌘W, Ctrl+W (kumo, 2026-11-22): the page in front shut, not the window; only from
// the page's first one (nothing open) the window. The page says which (appkey.tsx closePage); one
// that cannot, an Iridium from before, has its window closed.
func (u *ui) closePage(w application.Window) {
	ww, ok := w.(*application.WebviewWindow)
	if !ok || ww == nil {
		return
	}
	if ww == u.picker {
		ww.Hide()
		return
	}
	if ww.Name() == "ask" {
		return
	}
	ww.ExecJS(`window.__irClosePage ? window.__irClosePage() : window._wails.invoke("ir:win:close")`)
}

// pageKeys: ⌘W and ⌘R (Ctrl on Windows and Linux, F5 too). On a Mac they are the menu bar's.
func (u *ui) pageKeys() {
	if runtime.GOOS == "darwin" {
		return
	}
	u.app.KeyBinding.Add("CmdOrCtrl+W", u.closePage)
	u.app.KeyBinding.Add("CmdOrCtrl+R", u.reload)
	u.app.KeyBinding.Add("F5", u.reload)
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
	var ws []*application.WebviewWindow
	for _, w := range u.wins {
		if u.shows[w.Name()] == address {
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

// chromeJS is put in every Iridium's page a window shows: its top bar drags the window, a double
// click there maximises it; on Windows and Linux its edges resize it. The top bar is what the page
// marks data-app-drag (the keys, fields and links in it excepted); a page with none marked (an
// Iridium from before) has its top 40 pixels. Such a page draws no window keys either: they are
// put at its top right here, plainer, till the page has its own (data-win-keys).
var chromeJS = fmt.Sprintf(`(function(){
var mac=%t,max=false;
function inv(m){var w=window._wails;if(w&&w.invoke)w.invoke(m)}
addEventListener("ir-app",function(e){var d=e.detail||{};if(typeof d.max==="boolean")max=d.max});
var keys="button,a,input,textarea,select,label,summary,[role=button],[role=menuitem],[role=tab],[role=switch],[contenteditable=true],[contenteditable=''],[data-no-drag]";
function zone(e){var t=e.target;if(!(t instanceof Element)||t.closest(keys))return false;
if(document.querySelector("[data-app-drag]"))return !!t.closest("[data-app-drag]");return e.clientY<40}
var B=5;function edge(e){if(mac||max)return "";var x=e.clientX,y=e.clientY,w=innerWidth,h=innerHeight,v=y<B?"n":y>h-B?"s":"",s=x<B?"w":x>w-B?"e":"";return v||s?v+s+"-resize":""}
addEventListener("mousemove",function(e){var r=edge(e);document.documentElement.style.cursor=r||""},true);
addEventListener("mousedown",function(e){if(e.button!==0)return;var r=edge(e);
if(r){e.preventDefault();e.stopPropagation();inv("wails:resize:"+r);return}
if(e.detail===1&&zone(e)){inv("wails:drag")}},true);
addEventListener("dblclick",function(e){if(zone(e))inv("ir:win:max")},true);
function plain(){var have=document.querySelector("[data-win-keys]:not([data-win-keys=app])"),ours=document.querySelector("[data-win-keys=app]");
if(have){if(ours)ours.remove();return}if(ours||!document.body)return;
var d=document.createElement("div");d.setAttribute("data-win-keys","app");
d.style.cssText="position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;gap:8px";
[["min","#febc2e"],["max","#28c840"],["close","#ff5f57"]].forEach(function(k){var b=document.createElement("button");b.type="button";b.setAttribute("aria-label",k[0]);
b.style.cssText="width:12px;height:12px;border-radius:50%%;border:0;padding:0;cursor:default;background:"+k[1];b.onclick=function(){inv("ir:win:"+k[0])};d.appendChild(b)});
document.body.appendChild(d)}
setInterval(plain,2000);
})();
`, runtime.GOOS == "darwin")
