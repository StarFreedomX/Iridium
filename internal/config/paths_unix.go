//go:build !windows

package config

import "path/filepath"

func configHome() string { return filepath.Join(xdg("XDG_CONFIG_HOME", ".config"), "iridium") }
func stateHome() string  { return filepath.Join(xdg("XDG_STATE_HOME", ".local/state"), "iridium") }
