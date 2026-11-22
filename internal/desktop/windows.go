package desktop

import (
	"fmt"
	"slices"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Windows on Iridiums (kumo, 2026-11-22): as many as wanted, each on its own Iridium, opened from
// the picker (picker.go); the one in front is the one the control and the tray act on
// (u.win), and the app's next start opens the one used last (Config.Current). Closing one closes
// it; closing the last hides it, the app staying in the tray.

// watch takes w among the windows: in front as it is focused, its Iridium then the last used; its
// close as above.
func (u *ui) watch(w *application.WebviewWindow) {
	u.mu.Lock()
	u.wins = append(u.wins, w)
	u.mu.Unlock()
	w.OnWindowEvent(events.Common.WindowFocus, func(*application.WindowEvent) {
		u.mu.Lock()
		u.win = w
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
	w.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		u.mu.Lock()
		defer u.mu.Unlock()
		if len(u.wins) <= 1 {
			e.Cancel()
			w.Hide()
			return
		}
		u.wins = slices.DeleteFunc(u.wins, func(x *application.WebviewWindow) bool { return x == w })
		delete(u.shows, w.Name())
		if u.win == w {
			u.win = u.wins[len(u.wins)-1]
		}
	})
}

// newWindow opens another window on address, at link, a little off the one in front. On the main
// thread.
func (u *ui) newWindow(address, link string) {
	u.mu.Lock()
	u.nwin++
	name := fmt.Sprintf("w%d", u.nwin)
	front := u.win
	if u.shows == nil {
		u.shows = map[string]string{}
	}
	u.shows[name] = address
	u.mu.Unlock()
	w := u.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: name, Title: "Iridium", Width: 1200, Height: 800, MinWidth: 360, MinHeight: 480,
		URL: themed(link), CSS: pageCSS, JS: pageJS,
		Mac: application.MacWindow{TitleBar: application.MacTitleBarHidden, InvisibleTitleBarHeight: macBar},
	})
	if front != nil {
		x, y := front.Position()
		fw, fh := front.Size()
		w.SetSize(fw, fh)
		w.SetPosition(x+28, y+28)
	}
	u.watch(w)
	w.Show()
	w.Focus()
}
