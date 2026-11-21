//go:build !linux || wails_cgo || gtk3 || android || server

package application

// loadPlatform: Iridium's patch (linux_purego.go); other platforms load nothing late.
func loadPlatform() {}
