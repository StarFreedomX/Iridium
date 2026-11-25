//go:build !windows

package pathsafe

// BrowserDrives lists logical drives on Windows. Other systems have no drive list.
func BrowserDrives(_, _ []string) ([]string, error) {
	return nil, nil
}
