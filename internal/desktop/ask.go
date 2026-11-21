package desktop

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/kumoSleeping/iridium/internal/remote/executor"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// A request from an Iridium for more of this computer (docs/app.md "请求"): the Iridium may only
// ask; the app takes the request apart (command lines, each folder, each agent) and shows it in a
// small panel of its own (web/src/appwin, #ask), in Iridium's look, never in the Iridium's page:
// the person allows each item or not. One request at a time; no answer in time is no.

type asking struct {
	server, by string
	items      []executor.Item
	answer     chan []bool
}

var asks struct {
	one sync.Mutex // one panel at a time
	mu  sync.Mutex
	now *asking
	win *application.WebviewWindow
}

// askEach shows the panel for a request from server and waits for its answer.
func (u *ui) askEach(ctx context.Context, server, by string, items []executor.Item) []bool {
	asks.one.Lock()
	defer asks.one.Unlock()
	a := &asking{server: server, by: by, items: items, answer: make(chan []bool, 1)}
	asks.mu.Lock()
	asks.now = a
	asks.mu.Unlock()
	application.InvokeSync(func() {
		asks.win = u.app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name: "ask", Title: "Iridium", URL: "/#ask",
			Width: 360, Height: 132 + 44*len(items), DisableResize: true, AlwaysOnTop: true,
			Frameless: true, BackgroundType: application.BackgroundTypeTransparent,
			InitialPosition: application.WindowCentered,
			Mac:             application.MacWindow{Backdrop: application.MacBackdropTransparent, WindowLevel: application.MacWindowLevelFloating},
		})
		asks.win.Show()
		asks.win.Focus()
	})
	var yes []bool
	select {
	case yes = <-a.answer:
	case <-ctx.Done():
	}
	asks.mu.Lock()
	asks.now = nil
	w := asks.win
	asks.win = nil
	asks.mu.Unlock()
	if w != nil {
		application.InvokeAsync(w.Close)
	}
	if len(yes) != len(items) {
		return make([]bool, len(items))
	}
	return yes
}

// askState is the request the panel shows; nil: none.
func askState() map[string]any {
	asks.mu.Lock()
	defer asks.mu.Unlock()
	a := asks.now
	if a == nil {
		return map[string]any{"ask": nil}
	}
	items := []map[string]string{}
	for _, it := range a.items {
		items = append(items, map[string]string{"kind": it.Kind, "value": it.Value})
	}
	return map[string]any{"ask": map[string]any{"server": hostOf(a.server), "by": a.by, "items": items}}
}

// answerAsk is the panel's answer (a JSON array of bools, one an item).
func answerAsk(arg string) {
	var yes []bool
	_ = json.Unmarshal([]byte(arg), &yes)
	asks.mu.Lock()
	a := asks.now
	asks.mu.Unlock()
	if a != nil {
		select {
		case a.answer <- yes:
		default:
		}
	}
}
