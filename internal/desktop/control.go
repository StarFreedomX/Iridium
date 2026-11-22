package desktop

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// The control page (docs/app.md "应用页面") in a window of its own, over the Iridium's page left
// as it is (kumo, 2026-11-22): the app's own page, so the Iridium cannot press its switches.
// Going to a server from it shows that one in the main window and closes it.

// openControl shows the control window, made if it is not there. On the main thread.
func (u *ui) openControl() {
	u.mu.Lock()
	w := u.control
	u.mu.Unlock()
	if w == nil {
		w = u.app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name: "control", Title: "Iridium", Width: 440, Height: 640, MinWidth: 360, MinHeight: 420,
			URL: themed("/#servers"), CSS: pageCSS, JS: pageJS,
			Mac: application.MacWindow{TitleBar: application.MacTitleBarHidden, InvisibleTitleBarHeight: macBar},
		})
		w.RegisterHook(events.Common.WindowClosing, func(*application.WindowEvent) {
			u.mu.Lock()
			if u.control == w {
				u.control = nil
			}
			u.mu.Unlock()
		})
		u.mu.Lock()
		u.control = w
		u.mu.Unlock()
	}
	w.Show()
	w.Focus()
}

// closeControl closes the control window, if open.
func (u *ui) closeControl() {
	u.mu.Lock()
	w := u.control
	u.control = nil
	u.mu.Unlock()
	if w != nil {
		application.InvokeAsync(w.Close)
	}
}
