package desktop

import (
	"runtime"

	"github.com/egoist/mygo"
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
	opts := mygo.WindowOptions{
		Title: "Iridium", Width: pickerW, Height: pickerH, DisableResize: true, DisableMaximize: true,
		URL: themed("/"), Page: pageOptions("", "", 0),
	}
	if runtime.GOOS == "darwin" {
		opts.TitleBarStyle = mygo.TitleBarHidden
	}
	w := mygo.NewWindow(opts)
	if runtime.GOOS != "darwin" && len(u.icon) > 0 {
		_ = w.SetIcon(u.icon)
	}
	u.named(w, "picker")
	u.hideOnClose(w)
	u.mu.Lock()
	u.picker = w
	u.mu.Unlock()
}

// showPicker shows the picker with the state as it is now.
func (u *ui) showPicker() {
	u.mu.Lock()
	p := u.picker
	u.mu.Unlock()
	if p == nil {
		return
	}
	c, _ := loadConfig()
	reply(p, u.pageState(c))
	p.Show()
	p.Focus()
}

// tellPicker gives the picker a state, shown or not: it is whole as it shows.
func (u *ui) tellPicker(st map[string]any) {
	u.mu.Lock()
	p := u.picker
	u.mu.Unlock()
	if p != nil {
		reply(p, st)
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
	var w *mygo.Window
	for _, x := range u.wins {
		if u.shows[u.names[x]] == address {
			w = x
			break
		}
	}
	u.mu.Unlock()
	_, _ = updateConfig(func(c *Config) { c.Current = address })
	go func() {
		if w == nil {
			u.newWindow(address, link)
		} else {
			if !home {
				_ = w.Page().LoadURL(themed(link))
			}
			w.Show()
			w.Focus()
		}
		u.picker.Hide()
	}()
	u.redraw()
}

// vacate closes the window named: its Iridium is left (logged out there, removed).
func (u *ui) vacate(name string) {
	u.mu.Lock()
	var w *mygo.Window
	for _, x := range u.wins {
		if u.names[x] == name {
			w = x
		}
	}
	u.mu.Unlock()
	if w != nil {
		w.Close()
	}
}

// gone: address left the list; the windows on it are closed, and with none left on any the picker
// is shown.
func (u *ui) gone(address string) {
	u.mu.Lock()
	var names []string
	left := 0
	for _, x := range u.wins {
		if n := u.names[x]; u.shows[n] == address {
			names = append(names, n)
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
