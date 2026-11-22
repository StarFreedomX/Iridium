package desktop

import (
	"fmt"
	"slices"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Windows on Iridiums (kumo, 2026-11-22): as many as wanted, each on its own Iridium, opened from
// the picker (picker.go); the one in front is u.win (nil: none), and the app's next start ticks
// the one used last (Config.Current). Each is an ordinary window, made as it is shown and gone as
// it is closed: none is kept hidden. With none left the app stays in the tray.

// watch takes w among the windows: in front as it is focused, its Iridium then the last used.
func (u *ui) watch(w *application.WebviewWindow) {
	u.mu.Lock()
	u.wins = append(u.wins, w)
	u.win = w
	u.mu.Unlock()
	w.OnWindowEvent(events.Common.WindowFocus, func(*application.WindowEvent) {
		u.mu.Lock()
		if slices.Contains(u.wins, w) {
			u.win = w
		}
		at := u.shows[w.Name()]
		u.mu.Unlock()
		if at != "" {
			_, _ = updateConfig(func(c *Config) {
				if c.server(at) != nil {
					c.Current = at
				}
			})
		}
	})
	w.RegisterHook(events.Common.WindowClosing, func(*application.WindowEvent) {
		u.mu.Lock()
		defer u.mu.Unlock()
		u.wins = slices.DeleteFunc(u.wins, func(x *application.WebviewWindow) bool { return x == w })
		delete(u.shows, w.Name())
		if u.win == w {
			u.win = nil
			if n := len(u.wins); n > 0 {
				u.win = u.wins[n-1]
			}
		}
	})
	u.keepFrame(w)
}

// newWindow opens a window on address, at link: where and as large as one was last, a little off
// the one in front if there is one. On the main thread.
func (u *ui) newWindow(address, link string) {
	c, _ := loadConfig()
	u.mu.Lock()
	u.nwin++
	name := fmt.Sprintf("w%d", u.nwin)
	front := u.win
	if u.shows == nil {
		u.shows = map[string]string{}
	}
	u.shows[name] = address
	u.mu.Unlock()
	opts := application.WebviewWindowOptions{
		Name: name, Title: "Iridium", Width: 1200, Height: 800, MinWidth: 360, MinHeight: 480,
		URL: themed(link), CSS: pageCSS, JS: pageJS,
		// No title bar of its own on macOS (kumo, 2026-11-20: no line under it): the page goes up to
		// the window's top, the window dragged by that strip (pageCSS keeps it clear).
		// The strip's right end is the page's: the app's key is there (web/src/appkey.tsx).
		Mac: application.MacWindow{TitleBar: application.MacTitleBarHidden, InvisibleTitleBarHeight: macBar, InvisibleTitleBarClearRight: 44},
	}
	// Given as it is made: nothing of it is set after (set before the app ran, that hung it).
	if f := c.Frame; f.W >= 360 && f.H >= 480 {
		opts.Width, opts.Height = f.W, f.H
		opts.InitialPosition, opts.X, opts.Y = application.WindowXY, f.X, f.Y
	}
	if front != nil {
		x, y := front.Position()
		opts.Width, opts.Height = front.Size()
		opts.InitialPosition, opts.X, opts.Y = application.WindowXY, x+28, y+28
	}
	w := u.app.Window.NewWithOptions(opts)
	if c.Zoom > 0 {
		w.SetZoom(c.Zoom)
	}
	u.watch(w)
	w.Show()
	w.Focus()
}
