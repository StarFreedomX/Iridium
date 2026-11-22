package desktop

import (
	"encoding/json"
	"runtime"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// The control (docs/app.md "控制"): the popover under the key at an Iridium page's top right, drawn
// as the web app's popovers are (PopSurface: its surface, shadow, unfold), but the app's own (a
// window without a frame over the page): the Iridium cannot press its switches, so 授权操作 asks
// nothing more (kumo, 2026-11-22). Its window is made once the app has started, hidden, its page
// loaded with the state: opened, the page has its rows and height already, and the window is never
// sized again (its panel glides to its height inside). It hides as it loses the focus (a press
// outside), on Esc, or when it took the window somewhere.

const (
	controlW    = 352 // the panel, as wide as the web app's "+" popover
	controlSide = 32  // round the panel: its shadow's room (--shadow-float)
	controlTop  = 8
	controlFoot = 48
	controlMaxH = 640
)

// keyRect is where the key is in its page (CSS pixels from the page's top left).
type keyRect struct{ X, Y, W, H float64 }

// makeControl makes the control's window, hidden, once. On the main thread.
func (u *ui) makeControl() *application.WebviewWindow {
	u.mu.Lock()
	w := u.control
	u.mu.Unlock()
	if w != nil {
		return w
	}
	w = u.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "control", Title: "Iridium",
		Width: controlW + 2*controlSide, Height: controlTop + controlMaxH + controlFoot,
		URL: themed("/#control"), Frameless: true, DisableResize: true, AlwaysOnTop: true,
		BackgroundType: application.BackgroundTypeTransparent, Hidden: true,
		// No shadow of the system's: the panel draws the web app's own. Square corners: without
		// them a frameless window keeps AppKit's own frame, drawn as a white slab behind the panel
		// (kumo, 2026-11-22).
		Mac: application.MacWindow{Backdrop: application.MacBackdropTransparent, WindowLevel: application.MacWindowLevelFloating, DisableShadow: true, CornerType: application.MacWindowCornerTypeSquare},
	})
	w.OnWindowEvent(events.Common.WindowLostFocus, func(*application.WindowEvent) { u.closeControl() })
	u.mu.Lock()
	u.control = w
	u.mu.Unlock()
	return w
}

// openControl shows the control under the key of the window in front, its right edge in line
// with the key's (a popover aligned at its end); at the window's top right with no key given (the
// tray, ⌘,). On the main thread.
func (u *ui) openControl(arg string) {
	var r keyRect
	_ = json.Unmarshal([]byte(arg), &r)
	w := u.makeControl()
	u.mu.Lock()
	// The key pressed again with it open: the press took its focus and put it away; it stays away,
	// as a popover's trigger closes it.
	if time.Since(u.controlShut) < 300*time.Millisecond {
		u.mu.Unlock()
		return
	}
	front := u.win
	if u.shows[front.Name()] == "" {
		u.mu.Unlock()
		return // no window on an Iridium to open it over
	}
	u.controlOpen = true
	u.mu.Unlock()
	if front != nil {
		x, y := front.Position()
		fw, _ := front.Size()
		top := 0
		if runtime.GOOS == "windows" {
			top = 31 // the system's title bar above the page
		}
		zoom := front.GetZoom()
		if zoom <= 0 {
			zoom = 1
		}
		right, below := x+fw-8, y+top+48
		if r.W > 0 {
			right = x + int((r.X+r.W)*zoom)
			below = y + top + int((r.Y+r.H)*zoom)
		}
		w.SetPosition(right-controlW-controlSide, below+8-controlTop)
	}
	c, _ := loadConfig()
	st := u.pageState(c)
	st["open"] = true
	w.Show()
	w.Focus()
	reply(w, st)
}

// closeControl puts the control away, if open: its panel folds back (the page, as a popover's
// does), then the window hides.
func (u *ui) closeControl() {
	u.mu.Lock()
	if u.probeHold {
		u.mu.Unlock()
		return
	}
	w, open := u.control, u.controlOpen
	u.controlOpen = false
	if open {
		u.controlShut = time.Now()
	}
	u.mu.Unlock()
	if w == nil || !open {
		return
	}
	reply(w, map[string]any{"close": true})
	time.AfterFunc(180*time.Millisecond, func() {
		application.InvokeAsync(func() {
			u.mu.Lock()
			again := u.controlOpen
			u.mu.Unlock()
			if !again {
				w.Hide()
			}
		})
	})
}

// tellControlState gives the control the state afresh while it is open (a link's state changed).
func (u *ui) tellControlState(st map[string]any) {
	u.mu.Lock()
	w, open := u.control, u.controlOpen
	u.mu.Unlock()
	if w != nil && open {
		reply(w, st)
	}
}
