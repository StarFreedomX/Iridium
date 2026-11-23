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
	title := "Iridium"
	if s := c.server(address); s != nil {
		title = windowTitle(s.Title)
	}
	// No title bar on any system (chrome.go): the page goes up to the window's top, its own keys
	// at its top right.
	opts := bare(mygo.WindowOptions{
		Title: title, Width: 1200, Height: 800, MinWidth: 360, MinHeight: 480,
		URL: themed(link),
		// Trusted: this window's Iridium, no other (Wails took any origin's message and looked).
		Page: pageOptions(originOf(address), css(pageCSS)+pageJS, c.Zoom),
	})
	if runtime.GOOS != "darwin" {
		opts.AutoHideMenuBar = true // the menu only for its keys (bridge.go menuBar)
	}
	if f := c.Frame; f.W >= 360 && f.H >= 480 {
		opts.Width, opts.Height, opts.X, opts.Y = f.W, f.H, f.X, f.Y
	}
	if front != nil {
		x, y := front.Position()
		opts.Width, opts.Height = front.Size()
		opts.X, opts.Y = x+28, y+28
	}
	// A place left on a screen no longer there (a second screen taken away) is not kept: the
	// window comes in the middle of the main screen instead (QGI, 2026-11-23: off every screen).
	if !onScreen(mygo.Rectangle{X: opts.X, Y: opts.Y, Width: opts.Width, Height: opts.Height}) {
		opts.X, opts.Y = 0, 0 // mygo centres it
		if wa := mygo.Screen.PrimaryDisplay().WorkArea; wa.Width > 0 {
			opts.Width, opts.Height = min(opts.Width, wa.Width), min(opts.Height, wa.Height)
		}
	}
	w := mygo.NewWindow(opts)
	if runtime.GOOS != "darwin" && len(u.icon) > 0 {
		_ = w.SetIcon(u.icon)
	}
	guard(w, originOf(address))
	u.watch(w, name)
	followMax(w)
	w.Focus()
}

// onScreen: is enough of r on a screen there now to take hold of it (its top strip, which drags
// it: 120 by 40 points of it)? A zero place (X and Y 0) is mygo's centred, always on one.
func onScreen(r mygo.Rectangle) bool {
	if r.X == 0 && r.Y == 0 {
		return true
	}
	top := mygo.Rectangle{X: r.X, Y: r.Y, Width: r.Width, Height: 40}
	for _, d := range mygo.Screen.Displays() {
		wa := d.WorkArea
		w := min(top.X+top.Width, wa.X+wa.Width) - max(top.X, wa.X)
		h := min(top.Y+top.Height, wa.Y+wa.Height) - max(top.Y, wa.Y)
		if w >= 120 && h >= 20 {
			return true
		}
	}
	return false
}

// keepOnScreen brings back every window of the app left off the screens there now: as the
// screens change (one taken away), and as the app starts.
func (u *ui) keepOnScreen() {
	u.mu.Lock()
	ws := append([]*mygo.Window(nil), u.wins...)
	if u.picker != nil {
		ws = append(ws, u.picker)
	}
	u.mu.Unlock()
	wa := mygo.Screen.PrimaryDisplay().WorkArea
	for _, w := range ws {
		r := w.Bounds()
		if onScreen(r) || wa.Width == 0 {
			continue
		}
		r.Width, r.Height = min(r.Width, wa.Width), min(r.Height, wa.Height)
		r.X, r.Y = wa.X+(wa.Width-r.Width)/2, wa.Y+(wa.Height-r.Height)/2
		w.SetBounds(r)
	}
}
