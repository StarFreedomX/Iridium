package pathsafe

import (
	"path/filepath"
	"slices"
	"strings"

	"golang.org/x/sys/windows"
)

// BrowserDrives lists logical drives visible to this process and in the intersection of the
// computer's roots and the login's scope. It does not grant access to any real directory.
func (g *Guard) BrowserDrives(roots, scope []string) ([]string, error) {
	mask, err := windows.GetLogicalDrives()
	if err != nil {
		return nil, err
	}
	return driveNames(mask, g.browserRoots(roots, scope)), nil
}

// driveNames expands the bitmask into logical drive names containing an effective root.
func driveNames(mask uint32, roots []string) []string {
	out := []string{}
	for i := range 26 {
		if mask&(1<<i) == 0 {
			continue
		}
		name := string(rune('A'+i)) + ":"
		if roots == nil || slices.ContainsFunc(roots, func(root string) bool {
			return strings.EqualFold(filepath.VolumeName(root), name)
		}) {
			out = append(out, name)
		}
	}
	return out
}
