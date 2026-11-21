package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"sync"

	"github.com/kumoSleeping/iridium/internal/join"
)

// Server is an Iridium the app knows: its page in the window when it is the one shown, this
// computer joined to it while it is on.
type Server struct {
	URL string `json:"url"`
	Off bool   `json:"off,omitempty"` // not joined (still shown when chosen)
	// What it may do here (docs/exec.md): no command lines; only these folders ("": all).
	NoShell   bool     `json:"noShell,omitempty"`
	Roots     []string `json:"roots,omitempty"`
	AgentsOff []string `json:"agentsOff,omitempty"` // the agents it may not start here, by name
	// LoggedIn: the window was logged in to it (its cookie there); till its page says otherwise,
	// it is opened at once, not the app's login page.
	LoggedIn bool `json:"loggedIn,omitempty"`
	// Who the window is there (its page tells, irapp.ts), for the app's own page: name, face (a
	// data: URL).
	Name   string `json:"name,omitempty"`
	Avatar string `json:"avatar,omitempty"`
	// Face: the Iridium's own (GET /v1/internal/face, a data: URL), what stands for it in the list.
	Face string `json:"face,omitempty"`
}

// Config is the app's own, kept on this computer: what it joins and how. What an Iridium may do
// here is said here, never by the Iridium (docs/app.md "安全").
type Config struct {
	Servers []Server `json:"servers"`
	Current string   `json:"current,omitempty"` // the one in the window
	Name    string   `json:"name,omitempty"`    // this computer's name; "": the host name
	Theme   string   `json:"theme,omitempty"`   // "dark" or "light", as the Iridium's page last was
	Zoom    float64  `json:"zoom,omitempty"`    // the window's, as last set (⌘= ⌘- ⌘0); 0: 1
}

var cfgMu sync.Mutex

// configPath is the app's file: in the user's config directory, or IR_APP_CONFIG (tests).
func configPath() (string, error) {
	if p := os.Getenv("IR_APP_CONFIG"); p != "" {
		return p, nil
	}
	d, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "Iridium", "app.json"), nil
}

func loadConfig() (Config, error) {
	var c Config
	p, err := configPath()
	if err != nil {
		return c, err
	}
	b, err := os.ReadFile(p)
	if errors.Is(err, fs.ErrNotExist) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	return c, json.Unmarshal(b, &c)
}

func saveConfig(c Config) error {
	p, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(c, "", "  ")
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// update changes the config on disk under its lock.
func updateConfig(f func(*Config)) (Config, error) {
	cfgMu.Lock()
	defer cfgMu.Unlock()
	c, err := loadConfig()
	if err != nil {
		return c, err
	}
	f(&c)
	return c, saveConfig(c)
}

// add puts address in the list (once) and makes it the one shown.
func (c *Config) add(address string) {
	if !slices.ContainsFunc(c.Servers, func(s Server) bool { return s.URL == address }) {
		c.Servers = append(c.Servers, Server{URL: address})
	}
	c.Current = address
}

// current is the address shown in the window: the chosen one, else the first.
func (c *Config) current() string {
	if c.Current != "" && slices.ContainsFunc(c.Servers, func(s Server) bool { return s.URL == c.Current }) {
		return c.Current
	}
	if len(c.Servers) > 0 {
		return c.Servers[0].URL
	}
	return ""
}

// normalize is an address as join takes it.
func normalize(s string) (string, error) { return join.Address(s) }

func (c *Config) setOff(address string, off bool) {
	for i := range c.Servers {
		if c.Servers[i].URL == address {
			c.Servers[i].Off = off
		}
	}
}

func (c *Config) remove(address string) {
	c.Servers = slices.DeleteFunc(c.Servers, func(s Server) bool { return s.URL == address })
	if c.Current == address {
		c.Current = ""
	}
}

// server is address's entry, for changing in place; nil: not in the list.
func (c *Config) server(address string) *Server {
	for i := range c.Servers {
		if c.Servers[i].URL == address {
			return &c.Servers[i]
		}
	}
	return nil
}
