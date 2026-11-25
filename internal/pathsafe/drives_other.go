//go:build !windows

package pathsafe

// BrowserDrives lists logical drives on Windows. Other systems have no drive list.
func (g *Guard) BrowserDrives(_, _ []string) ([]string, error) {
	return nil, nil
}
