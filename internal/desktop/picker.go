package desktop

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// The picker (docs/app.md "小窗口"; kumo, 2026-11-22): a small upright window of the app's own,
// an ordinary one: 服务器 (此电脑, run or not, 公网访问; each Iridium in the list; adding one,
// logging in) and 授权操作 (each Iridium logged in to: may it work on this computer, and how far).
// An Iridium pressed, the picker goes and that Iridium's window comes: the one already on it, else
// a new one. A window on an Iridium shows that Iridium's page and never the app's own: what is
// waited for (this computer's starting, a login in the browser) is said in the picker.

const (
	pickerW = 380
	pickerH = 640
)

// makePicker makes the picker's window, shown. Closed, it hides: its page keeps its state and is
// whole as it shows again.
func (u *ui) makePicker() {
	// No title bar (chrome.go): its own strip at the top, the mark and the name at the left, its
	// keys at the right, a Mac as Windows.
	w := u.app.Window.NewWithOptions(bare(application.WebviewWindowOptions{
		Name: "picker", Title: "Iridium", Width: pickerW, Height: pickerH, DisableResize: true,
		URL: themed("/"), InitialPosition: application.WindowCentered,
	}))
	w.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		e.Cancel()
		w.Hide()
	})
	u.picker = w
}

// showPicker shows the picker with the state as it is now, on the screen of the window used last
// (kumo, 2026-11-22: it came back on the screen it was last on, away from where one works).
func (u *ui) showPicker() {
	c, _ := loadConfig()
	reply(u.picker, u.pageState(c))
	u.mu.Lock()
	front := u.win
	u.mu.Unlock()
	if front != nil && !u.picker.IsVisible() {
		if to, err := front.GetScreen(); err == nil && to != nil {
			if at, err := u.picker.GetScreen(); err != nil || at == nil || at.ID != to.ID {
				u.picker.SetScreen(to)
			}
		}
	}
	u.picker.Show()
	u.picker.Focus()
}

// tellPicker gives the picker a state, shown or not: it is whole as it shows.
func (u *ui) tellPicker(st map[string]any) {
	if u.picker != nil {
		reply(u.picker, st)
	}
}

// openIn shows address in a window, at link (its own page if ""): the window already on it, else
// a new one; the picker goes.
func (u *ui) openIn(address, link string) {
	home := link == ""
	if home {
		link = address + "/"
	}
	u.mu.Lock()
	var w *application.WebviewWindow
	for _, x := range u.wins {
		if u.shows[x.Name()] == address {
			w = x
			break
		}
	}
	u.mu.Unlock()
	_, _ = updateConfig(func(c *Config) { c.Current = address })
	application.InvokeAsync(func() {
		if w == nil {
			u.newWindow(address, link)
		} else {
			if !home {
				w.SetURL(themed(link))
			}
			w.Show()
			w.Focus()
		}
		u.picker.Hide()
	})
	u.redraw()
}

// vacate closes the window named: its Iridium is left (logged out there, removed).
func (u *ui) vacate(name string) {
	u.mu.Lock()
	var w *application.WebviewWindow
	for _, x := range u.wins {
		if x.Name() == name {
			w = x
		}
	}
	u.mu.Unlock()
	if w != nil {
		application.InvokeAsync(w.Close)
	}
}

// gone: address left the list; the windows on it are closed, and with none left on any the picker
// is shown.
func (u *ui) gone(address string) {
	u.mu.Lock()
	var names []string
	left := 0
	for _, x := range u.wins {
		if u.shows[x.Name()] == address {
			names = append(names, x.Name())
		} else {
			left++
		}
	}
	u.mu.Unlock()
	for _, n := range names {
		u.vacate(n)
	}
	if len(names) > 0 && left == 0 {
		u.showPicker()
	}
}
