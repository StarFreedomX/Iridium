package desktop

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/kumoSleeping/iridium/internal/cli"
	"github.com/kumoSleeping/iridium/internal/config"
	"github.com/kumoSleeping/iridium/internal/public"
)

// 公网访问 (docs/app.md): this computer's Iridium on the internet through a Cloudflare tunnel of
// its own, the same as ir public, with no terminal: Cloudflare's login in the browser (cloudflared
// opens it; its link shown too), the subdomain ir, the rest done; the first invite shown for the
// phone. The window keeps coming in on loopback (public.localWindow).

type publicState struct {
	mu     sync.Mutex
	busy   bool
	note   string // the last step, short
	link   string // Cloudflare's login link, while it waits for it
	invite string // the first invite, once there
	err    string
}

func (p *publicState) view() map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	return map[string]any{"busy": p.busy, "note": p.note, "link": p.link, "invite": p.invite, "error": p.err}
}

// publicOn: is this computer's Iridium on the internet?
func publicOn() bool {
	cfg, err := config.Load(localPath())
	return err == nil && cfg.Public.Origin != ""
}

// setPublic turns it on or off; changed is told at each step.
func (p *publicState) set(on bool, changed func(), logf func(string, ...any)) {
	p.mu.Lock()
	if p.busy {
		p.mu.Unlock()
		return
	}
	p.busy, p.note, p.link, p.invite, p.err = true, "", "", "", ""
	p.mu.Unlock()
	changed()
	out := lineWriter(func(l string) {
		logf("public: %s", l)
		p.mu.Lock()
		p.note = brief(strings.TrimSpace(l))
		p.mu.Unlock()
		changed()
	})
	var err error
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	if on {
		// The window on loopback still comes in, once there is a public origin.
		path := localPath()
		if cfg, e := config.Load(path); e == nil && !cfg.Public.LocalWindow {
			cfg.Public.LocalWindow = true
			_ = cfg.Save(path)
		}
		var o public.Options
		if o, err = cli.PublicOptions(path, out); err == nil {
			o.Ask = nil
			o.OnLink = func(url string) {
				p.mu.Lock()
				p.link = url
				p.mu.Unlock()
				changed()
			}
			o.OnInvite = func(url string, _ time.Time) {
				p.mu.Lock()
				p.invite, p.link = url, ""
				p.mu.Unlock()
				changed()
			}
			err = public.On(ctx, o)
		}
	} else {
		err = cli.PublicOff(ctx, localPath(), out)
	}
	p.mu.Lock()
	p.busy, p.link = false, ""
	if err != nil {
		p.err = err.Error()
	} else {
		p.note = ""
	}
	p.mu.Unlock()
	changed()
}

// publicAddress is this computer's Iridium's public address; "": none.
func publicAddress() string {
	cfg, err := config.Load(localPath())
	if err != nil {
		return ""
	}
	return cfg.Public.Origin
}
