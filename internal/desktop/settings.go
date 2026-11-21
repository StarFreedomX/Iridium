package desktop

import (
	"fmt"
	"slices"

	"github.com/kumoSleeping/iridium/internal/join"
)

// What ir start, ir server, ir join and ir leave change: the settings the runtime follows (and
// the window shows), app.json.

// Fresh: no settings yet (ir has never been started or opened here).
func Fresh() bool { return !configExists() }

// SetServer turns this computer's own Iridium on or off.
func SetServer(on bool) error {
	_, err := updateConfig(func(c *Config) { c.NoServer = !on })
	return err
}

// ServerOn: is this computer's own Iridium on in the settings?
func ServerOn() bool {
	c, _ := loadConfig()
	return !c.NoServer
}

// Join puts t's Iridiums in the settings, joined under t's terms (this computer's name too, when
// given).
func Join(t Terms) error {
	agents := join.FindAgents(func(string, ...any) {})
	_, err := updateConfig(func(c *Config) {
		if t.Name != "" {
			c.Name = t.Name
		}
		for _, a := range t.Addrs {
			s := t.server(a, agents)
			if c.server(a) == nil {
				c.Servers = append(c.Servers, Server{URL: a})
			}
			e := c.server(a)
			e.Off, e.NoShell, e.Roots, e.AgentsOff, e.Proxy = false, s.NoShell, s.Roots, s.AgentsOff, s.Proxy
		}
	})
	return err
}

// Leave stops joining address (it stays in the window's list, not joined).
func Leave(address string) error {
	a, err := normalize(address)
	if err != nil {
		return err
	}
	found := false
	_, err = updateConfig(func(c *Config) {
		if s := c.server(a); s != nil && !s.Local {
			s.Off, found = true, true
		}
	})
	if err == nil && !found {
		return fmt.Errorf("not joined to %s", a)
	}
	return err
}

// Joined are the Iridiums the settings join.
func Joined() []string {
	c, _ := loadConfig()
	var out []string
	for _, s := range c.Servers {
		if !s.Off && !s.Local && !slices.Contains(out, s.URL) {
			out = append(out, s.URL)
		}
	}
	return out
}

// RuntimeRecord is the running runtime's record; ok false: none runs.
func RuntimeRecord() (Record, bool) {
	for _, r := range Running() {
		if r.Kind == "runtime" {
			return r, true
		}
	}
	return Record{}, false
}
