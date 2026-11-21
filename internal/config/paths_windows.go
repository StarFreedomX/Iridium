//go:build windows

package config

import (
	"os"
	"path/filepath"
)

// configHome is %APPDATA%\Iridium (roaming), stateHome %LOCALAPPDATA%\Iridium\state (this
// machine's alone: the database, the holders, the socket). XDG_* still win when set.
func configHome() string {
	if d := os.Getenv("XDG_CONFIG_HOME"); d != "" {
		return filepath.Join(d, "iridium")
	}
	if d, err := os.UserConfigDir(); err == nil {
		return filepath.Join(d, "Iridium")
	}
	return filepath.Join(xdg("", ".config"), "iridium")
}

func stateHome() string {
	if d := os.Getenv("XDG_STATE_HOME"); d != "" {
		return filepath.Join(d, "iridium")
	}
	if d := os.Getenv("LOCALAPPDATA"); d != "" {
		return filepath.Join(d, "Iridium", "state")
	}
	return filepath.Join(xdg("", ".local/state"), "iridium")
}
