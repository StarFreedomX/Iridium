//go:build !darwin

package desktop

// unopened: never so but on macOS (unopened_darwin.go).
func unopened(string) bool { return false }
