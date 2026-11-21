//go:build windows

package desktop

import "github.com/kumoSleeping/iridium/internal/platform"

// alive: does process pid run?
func alive(pid int) bool { return platform.Alive(pid) }
