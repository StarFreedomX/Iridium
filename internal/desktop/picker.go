package desktop

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// The picker (docs/app.md "小窗口"; kumo, 2026-11-22): a small upright window of the app's own
// with the Iridiums in it: 此电脑 (run or not, 公网访问), each one in the list, adding one, logging
// in. One pressed, the picker goes and that Iridium's window comes: the one already on it, else
// one with nothing in it, else a new one. A window on an Iridium shows that Iridium's page and
// never the app's own: what is waited for (this computer's starting, a login in the browser) is
// said in the picker.

// blankPage is the app's page with nothing drawn: a window that has no Iridium yet, hidden.
const blankPage = "/#blank"

const (
	pickerW = 380
	pickerH = 620
)

// makePicker makes the picker's window, hidden or not. Closed, it hides: its page keeps its state
// and is whole as it shows again.
func (u *ui) makePicker(hidden bool) {
	w := u.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "picker", Title: "Iridium", Width: pickerW, Height: pickerH, DisableResize: true,
		URL: themed("/"), Hidden: hidden, InitialPosition: application.WindowCentered,
		MaximiseButtonState: application.ButtonHidden,
		Mac:                 application.MacWindow{TitleBar: application.MacTitleBarHidden, InvisibleTitleBarHeight: macBar},
	})
	w.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		e.Cancel()
		w.Hide()
	})
	u.picker = w
}

// showPicker shows the picker with the state as it is now.
func (u *ui) showPicker() {
	c, _ := loadConfig()
	reply(u.picker, u.pageState(c))
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
// one with nothing in it, else a new one; the picker and the control go.
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
	had := w != nil
	if w == nil {
		for _, x := range u.wins {
			if u.shows[x.Name()] == "" {
				w = x
				break
			}
		}
	}
	if w != nil {
		if u.shows == nil {
			u.shows = map[string]string{}
		}
		u.shows[w.Name()] = address
		u.win = w
	}
	u.mu.Unlock()
	_, _ = updateConfig(func(c *Config) { c.Current = address })
	u.picker.Hide()
	u.closeControl()
	if w == nil {
		application.InvokeAsync(func() { u.newWindow(address, link) })
	} else {
		if !had || !home {
			w.SetURL(themed(link))
		}
		w.Show()
		w.Focus()
	}
	application.InvokeAsync(u.redraw)
}

// vacate gives up the window named: closed, or, the only one, emptied and hidden.
func (u *ui) vacate(name string) {
	u.mu.Lock()
	var w *application.WebviewWindow
	for _, x := range u.wins {
		if x.Name() == name {
			w = x
		}
	}
	only := len(u.wins) <= 1
	delete(u.shows, name)
	u.mu.Unlock()
	if w == nil {
		return
	}
	if only {
		w.SetURL(themed(blankPage))
		w.Hide()
		return
	}
	application.InvokeAsync(w.Close)
}

// gone: address left the list; the windows on it are given up, and with none left on any the
// picker is shown.
func (u *ui) gone(address string) {
	u.mu.Lock()
	var names []string
	left := 0
	for _, x := range u.wins {
		switch u.shows[x.Name()] {
		case address:
			names = append(names, x.Name())
		case "":
		default:
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
