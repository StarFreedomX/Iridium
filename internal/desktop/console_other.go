//go:build !windows

package desktop

// hideConsole: a console of the app's own is Windows' alone.
func hideConsole() {}
