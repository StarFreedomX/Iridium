package desktop

import (
	"fmt"
	"runtime"
	"slices"

	"github.com/egoist/mygo"
)

// Windows on Iridiums (kumo, 2026-11-22): as many as wanted, each on its own Iridium, opened from
// the picker (picker.go); the one in front is u.win (nil: none), and the app's next start ticks
// the one used last (Config.Current). Each is an ordinary window, made as it is shown and gone as
// it is closed: none is kept hidden. With none left the app stays in the tray.

// watch takes w among the windows: in front as it is focused, its Iridium then the last used.
func (u *ui) watch(w *mygo.Window, name string) {
	u.named(w, name)
	u.mu.Lock()
	u.wins = append(u.wins, w)
	u.win = w
	u.mu.Unlock()
	w.OnFocus(func() {
		u.mu.Lock()
		if slices.Contains(u.wins, w) {
			u.win = w
		}
		at := u.shows[name]
		u.mu.Unlock()
		if at != "" {
			go updateConfig(func(c *Config) {
				if c.server(at) != nil {
					c.Current = at
				}
			})
		}
	})
	w.OnClosed(func() {
		u.mu.Lock()
		defer u.mu.Unlock()
		u.wins = slices.DeleteFunc(u.wins, func(x *mygo.Window) bool { return x == w })
		delete(u.shows, name)
		delete(u.names, w)
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
// the one in front if there is one.
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
	opts := mygo.WindowOptions{
		Title: "Iridium", Width: 1200, Height: 800, MinWidth: 360, MinHeight: 480,
		URL: themed(link),
		// Trusted: this window's Iridium, no other (Wails took any origin's message and looked).
		Page: pageOptions(originOf(address), css(pageCSS)+pageJS, c.Zoom),
	}
	if runtime.GOOS == "darwin" {
		// No title bar of its own on macOS (kumo, 2026-11-20: no line under it): the page goes up
		// to the window's top, the window dragged by that strip (pageCSS keeps it clear).
		opts.TitleBarStyle = mygo.TitleBarHidden
	} else {
		opts.AutoHideMenuBar = true // the menu only for its keys (gui)
	}
	if f := c.Frame; f.W >= 360 && f.H >= 480 {
		opts.Width, opts.Height, opts.X, opts.Y = f.W, f.H, f.X, f.Y
	}
	if front != nil {
		x, y := front.Position()
		opts.Width, opts.Height = front.Size()
		opts.X, opts.Y = x+28, y+28
	}
	w := mygo.NewWindow(opts)
	if runtime.GOOS != "darwin" && len(u.icon) > 0 {
		_ = w.SetIcon(u.icon)
	}
	u.watch(w, name)
	w.Focus()
}
