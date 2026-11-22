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
	answer     chan askReply
}

// askReply is the panel's answer: one yes or no an item; always, this Iridium is not asked again.
type askReply struct {
	Yes    []bool `json:"yes"`
	Always bool   `json:"always"`
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
	a := &asking{server: server, by: by, items: items, answer: make(chan askReply, 1)}
	asks.mu.Lock()
	asks.now = a
	asks.mu.Unlock()
	application.InvokeSync(func() {
		asks.win = u.app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name: "ask", Title: "Iridium", URL: "/#ask",
			Width: 360, Height: 132 + 44*len(items), DisableResize: true, AlwaysOnTop: true,
			Frameless: true, BackgroundType: application.BackgroundTypeTransparent,
			InitialPosition: application.WindowCentered,
			Mac:             application.MacWindow{Backdrop: application.MacBackdropTransparent, WindowLevel: application.MacWindowLevelFloating, CornerType: application.MacWindowCornerTypeSquare},
		})
		asks.win.Show()
		asks.win.Focus()
	})
	var r askReply
	select {
	case r = <-a.answer:
	case <-ctx.Done():
	}
	yes := r.Yes
	if r.Always && server != "" {
		_, _ = updateConfig(func(c *Config) {
			if s := c.server(server); s != nil {
				s.AlwaysAllow = true
			}
		})
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

// answerAsk is the panel's answer (reply as JSON, or a JSON array of bools, one an item).
func answerAsk(arg string) {
	var r askReply
	if json.Unmarshal([]byte(arg), &r) != nil {
		_ = json.Unmarshal([]byte(arg), &r.Yes)
	}
	asks.mu.Lock()
	a := asks.now
	asks.mu.Unlock()
	if a != nil {
		select {
		case a.answer <- r:
		default:
		}
	}
}
