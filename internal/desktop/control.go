package desktop

import (
	"encoding/json"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// The control (docs/app.md "控制"): a popover under the key at an Iridium page's top right, as the
// web app's popovers look, but the app's own (a window without a frame over the page): the
// Iridium cannot press its switches, so 授权操作 asks nothing more (kumo, 2026-11-22). It closes
// as it loses the focus (a press outside), on Esc, or when it took the window somewhere.

const controlW = 340

// keyRect is where the key is in its page (CSS pixels from the page's top left).
type keyRect struct{ X, Y, W, H float64 }

// openControl shows the control under the key of the window in front; at its top right with no
// key given (the tray, ⌘,). On the main thread.
func (u *ui) openControl(arg string) {
	var r keyRect
	_ = json.Unmarshal([]byte(arg), &r)
	u.mu.Lock()
	w, front := u.control, u.win
	u.mu.Unlock()
	if w == nil {
		w = u.app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name: "control", Title: "Iridium", Width: controlW, Height: 420,
			URL: themed("/#control"), Frameless: true, DisableResize: true, AlwaysOnTop: true,
			BackgroundType: application.BackgroundTypeTransparent, Hidden: true,
			Mac: application.MacWindow{Backdrop: application.MacBackdropTransparent, WindowLevel: application.MacWindowLevelFloating},
		})
		w.OnWindowEvent(events.Common.WindowLostFocus, func(*application.WindowEvent) { u.closeControl() })
		u.mu.Lock()
		u.control = w
		u.mu.Unlock()
	}
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
		px := x + fw - controlW - 8
		py := y + top + 48
		if r.W > 0 {
			px = x + int((r.X+r.W)*zoom) - controlW + 8
			py = y + top + int((r.Y+r.H)*zoom) + 2
		}
		w.SetPosition(px, py)
	}
	w.Show()
	w.Focus()
}

// sizeControl is the control's height as its page says it fits (at most most of a screen).
func (u *ui) sizeControl(h int) {
	u.mu.Lock()
	w := u.control
	u.mu.Unlock()
	if w == nil || h <= 0 {
		return
	}
	if h > 680 {
		h = 680
	}
	w.SetSize(controlW, h)
}

// closeControl closes the control, if open.
func (u *ui) closeControl() {
	u.mu.Lock()
	w := u.control
	u.control = nil
	u.mu.Unlock()
	if w != nil {
		application.InvokeAsync(w.Close)
	}
}
