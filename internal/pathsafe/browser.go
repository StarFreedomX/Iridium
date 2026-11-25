package pathsafe

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// BrowserDirectory describes either a real directory (Real) or the directory names that may be
// shown on the way to one. A projected directory grants no filesystem access.
type BrowserDirectory struct {
	Path, Real string
	Children   []string
}

// BrowserDirectory resolves a listing or projects the next steps to granted directories without
// reading the ancestor's entries.
func (g *Guard) BrowserDirectory(path string, roots, scope []string) (BrowserDirectory, error) {
	if !filepath.IsAbs(path) {
		return BrowserDirectory{}, ErrRelative
	}
	path = filepath.Clean(path)
	real, err := Resolve(path)
	if err != nil {
		return BrowserDirectory{}, err
	}
	if g.denied(path) || g.denied(real) {
		return BrowserDirectory{}, fmt.Errorf("%w: %s", ErrDenied, path)
	}
	if err := CheckBrowser(path, real); err != nil {
		return BrowserDirectory{}, err
	}
	allowed := g.browserRoots(roots, scope)
	out := BrowserDirectory{Path: path}
	if allowed == nil || slices.ContainsFunc(allowed, func(root string) bool { return Within(real, root) }) {
		out.Real = real
		return out, nil
	}
	seen := map[string]bool{}
	for _, root := range allowed {
		rel, err := filepath.Rel(real, root)
		if err != nil || rel == "." || !filepath.IsLocal(rel) {
			continue
		}
		name, _, _ := strings.Cut(rel, string(filepath.Separator))
		// An exception inside a denied directory does not make that directory navigable.
		blocked := false
		for dir := root; !Within(real, dir); dir = filepath.Dir(dir) {
			tail, _ := filepath.Rel(real, dir)
			if g.denied(dir) || g.denied(filepath.Join(path, tail)) {
				blocked = true
				break
			}
		}
		key := name
		if filepath.Separator == '\\' {
			key = strings.ToLower(key)
		}
		if !blocked && !seen[key] {
			out.Children = append(out.Children, name)
			seen[key] = true
		}
	}
	if len(out.Children) == 0 {
		return BrowserDirectory{}, fmt.Errorf("%w: %s", ErrOutside, path)
	}
	slices.Sort(out.Children)
	return out, nil
}

// browserRoots returns canonical, existing directory roots in the intersection, with the login's
// order taking precedence. Nil is unrestricted, unlike an empty result from restricted inputs.
func (g *Guard) browserRoots(roots, scope []string) []string {
	if len(roots) == 0 {
		roots = g.allow
	}
	resolve := func(paths []string) []string {
		if paths == nil {
			return nil
		}
		out := []string{}
		for _, p := range paths {
			if !filepath.IsAbs(p) || g.denied(p) {
				continue
			}
			real, err := filepath.EvalSymlinks(p)
			if err != nil || g.denied(real) || CheckBrowser(p, real) != nil {
				continue
			}
			if st, err := os.Stat(real); err == nil && st.IsDir() {
				out = append(out, real)
			}
		}
		return out
	}
	if len(scope) == 0 {
		scope = nil
	}
	return intersectBrowserRoots(resolve(roots), resolve(scope))
}

// intersectBrowserRoots keeps the narrower path of each overlapping (root, scope) pair in
// scope order; nil on either side means unrestricted.
func intersectBrowserRoots(roots, scope []string) []string {
	if roots == nil {
		return scope
	}
	if scope == nil {
		return roots
	}
	out := []string{}
	for _, allowed := range scope {
		for _, root := range roots {
			switch {
			case Within(allowed, root):
				out = append(out, allowed)
			case Within(root, allowed):
				out = append(out, root)
			}
		}
	}
	return out
}
