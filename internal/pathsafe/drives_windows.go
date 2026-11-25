package pathsafe

import (
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

// BrowserDrives lists logical drives visible to this process and in the intersection of the
// computer's roots and the login's scope. It does not grant access to any real directory.
func BrowserDrives(roots, scope []string) ([]string, error) {
	mask, err := windows.GetLogicalDrives()
	if err != nil {
		return nil, err
	}
	return driveNames(mask, resolvedBrowserRoots(roots, filepath.EvalSymlinks), resolvedBrowserRoots(scope, Resolve)), nil
}

// resolvedBrowserRoots resolves a non-empty root list for drive matching, omitting relative or
// browser-hidden paths. A nil return means unrestricted, distinct from an empty slice when no
// configured root is usable.
func resolvedBrowserRoots(roots []string, resolve func(string) (string, error)) []string {
	if len(roots) == 0 {
		return nil // unrestricted, distinct from a nonempty list with no usable roots
	}
	out := []string{}
	for _, root := range roots {
		if !filepath.IsAbs(root) {
			continue
		}
		real, err := resolve(root)
		if err == nil && CheckBrowser(root, real) == nil {
			out = append(out, real)
		}
	}
	return out
}

// driveNames expands a Windows logical-drive bitmask into sorted "C:" names allowed by roots and scope.
func driveNames(mask uint32, roots, scope []string) []string {
	out := []string{}
	for i := range 26 {
		if mask&(1<<i) == 0 {
			continue
		}
		name := string(rune('A'+i)) + ":"
		if driveInScope(name, roots, scope) {
			out = append(out, name)
		}
	}
	return out
}

// driveInScope reports whether drive holds any path in the intersection of roots and scope
// (either a scope entry under a root or a root under a scope entry).
func driveInScope(drive string, roots, scope []string) bool {
	onDrive := func(path string) bool { return strings.EqualFold(filepath.VolumeName(path), drive) }
	if roots == nil {
		if scope == nil {
			return true
		}
		roots, scope = scope, nil
	}
	within := func(path, root string) bool {
		rel, err := filepath.Rel(root, path)
		return err == nil && filepath.IsLocal(rel)
	}
	for _, root := range roots {
		if !onDrive(root) {
			continue
		}
		if scope == nil {
			return true
		}
		for _, allowed := range scope {
			if within(allowed, root) || within(root, allowed) {
				return true
			}
		}
	}
	return false
}
