package pathsafe

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestGuard(t *testing.T) {
	root, _ := filepath.EvalSymlinks(t.TempDir())
	work := filepath.Join(root, "work")
	secret := filepath.Join(root, "secret")
	state := filepath.Join(root, "state")
	other := filepath.Join(root, "other")
	for _, d := range []string{work, secret, filepath.Join(state, "uploads"), other} {
		os.MkdirAll(d, 0o700)
	}
	os.WriteFile(filepath.Join(secret, "key"), []byte("k"), 0o600)
	os.WriteFile(filepath.Join(work, "a.txt"), []byte("a"), 0o600)
	os.WriteFile(filepath.Join(other, "b.txt"), []byte("b"), 0o600)
	// Links out of the allowed root, into a denied directory, and a dangling one into it.
	os.Symlink(filepath.Join(secret, "key"), filepath.Join(work, "key-link"))
	os.Symlink(secret, filepath.Join(work, "secret-dir"))
	os.Symlink(filepath.Join(secret, "new"), filepath.Join(work, "dangling"))
	os.Symlink(other, filepath.Join(work, "other-dir"))
	// A denied directory reached through a link to it: the deny list resolves too.
	os.Symlink(secret, filepath.Join(root, "secret-alias"))

	g := New([]string{work}, []string{secret, state}, []string{filepath.Join(state, "uploads")})
	for _, c := range []struct {
		path string
		want error
	}{
		{filepath.Join(work, "a.txt"), nil},
		{filepath.Join(work, "not-yet", "c.txt"), nil}, // need not exist
		{filepath.Join(work, "key-link"), ErrDenied},
		{filepath.Join(work, "secret-dir", "key"), ErrDenied},
		{filepath.Join(work, "dangling"), ErrDenied},
		{filepath.Join(work, "other-dir", "b.txt"), ErrOutside},
		{filepath.Join(work, "..", "other", "b.txt"), ErrOutside},
		{filepath.Join(secret, "key"), ErrDenied},
		{filepath.Join(state, "iridium.db"), ErrDenied},
		{filepath.Join(state, "uploads", "x"), ErrOutside}, // excepted from the deny, still outside work
		{"relative/path", ErrRelative},
	} {
		_, err := g.Check(c.path)
		if !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", c.path, err, c.want)
		}
	}

	// Anywhere but the denied directories.
	any := New(nil, []string{filepath.Join(root, "secret-alias"), state}, []string{filepath.Join(state, "uploads")})
	if r, err := any.Check(filepath.Join(work, "other-dir", "b.txt")); err != nil || r != filepath.Join(other, "b.txt") {
		t.Errorf("anywhere: %q %v", r, err)
	}
	if _, err := any.Check(filepath.Join(secret, "key")); !errors.Is(err, ErrDenied) {
		t.Errorf("denied through the alias: %v", err)
	}
	if _, err := any.Check(filepath.Join(state, "uploads", "f")); err != nil {
		t.Errorf("exception: %v", err)
	}
}

func TestDenyList(t *testing.T) {
	home, _ := os.UserHomeDir()
	d := Deny("/s", "/c")
	g := New(nil, d, nil)
	for _, p := range []string{"/s/x", "/c/config.json", home + "/.ssh/id_ed25519", home + "/.claude/x", home + "/.codex", home + "/.pi/agent", home + "/.dsh/k", "/proc/self/environ"} {
		if _, err := g.Check(p); !errors.Is(err, ErrDenied) {
			t.Errorf("%s: %v", p, err)
		}
	}
	if _, err := g.Check(home + "/.sshx"); err != nil {
		t.Errorf("a sibling with the same prefix: %v", err)
	}
}

func TestBrowserDirectory(t *testing.T) {
	base := t.TempDir()
	top := filepath.Join(base, "shared")
	work := filepath.Join(top, "work", "project")
	notes := filepath.Join(top, "notes")
	private := filepath.Join(top, "private")
	missing := filepath.Join(top, "missing")
	hidden := filepath.Join(top, ".hidden")
	for _, p := range []string{work, notes, private, hidden} {
		if err := os.MkdirAll(p, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{filepath.Join(top, "unrelated"), filepath.Join(top, "file.txt")} {
		if err := os.WriteFile(p, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	g := New(nil, []string{private}, nil)
	roots := []string{top}
	scope := []string{missing, private, work, notes, hidden, filepath.Join(base, "unshared")}
	dir, err := g.BrowserDirectory(top, roots, scope)
	if err != nil || dir.Real != "" || !slices.Equal(dir.Children, []string{"notes", "work"}) {
		t.Fatalf("projection: %+v, %v", dir, err)
	}
	dir, err = g.BrowserDirectory(work, roots, scope)
	if err != nil || dir.Real == "" || len(dir.Children) != 0 {
		t.Fatalf("open directory: %+v, %v", dir, err)
	}
	if _, err := g.BrowserDirectory(top, []string{work}, []string{notes}); !errors.Is(err, ErrOutside) {
		t.Fatalf("disjoint roots: %v", err)
	}
	if _, err := g.BrowserDirectory(private, roots, scope); !errors.Is(err, ErrDenied) {
		t.Fatalf("private directory: %v", err)
	}
	if _, err := g.BrowserDirectory(hidden, roots, scope); !errors.Is(err, ErrDenied) {
		t.Fatalf("hidden directory: %v", err)
	}
	t.Run("alias", func(t *testing.T) {
		link := filepath.Join(base, "alias")
		if err := os.Symlink(private, link); err != nil {
			t.Skipf("no directory links: %v", err)
		}
		if _, err := g.BrowserDirectory(link, roots, scope); !errors.Is(err, ErrDenied) {
			t.Fatalf("alias into denied directory: %v", err)
		}
	})
	t.Run("no path through a deny", func(t *testing.T) {
		exception := filepath.Join(private, "public")
		if err := os.Mkdir(exception, 0o700); err != nil {
			t.Fatal(err)
		}
		g := New(nil, []string{private}, []string{exception})
		if _, err := g.BrowserDirectory(top, nil, []string{exception}); !errors.Is(err, ErrOutside) {
			t.Fatalf("projection through denied directory: %v", err)
		}
	})
}
