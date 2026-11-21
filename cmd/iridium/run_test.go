package main

import (
	"flag"
	"slices"
	"testing"
)

func TestJoinArgs(t *testing.T) {
	for in, want := range map[string][]string{
		"https://a --name nas --no-shell":     {"--join", "https://a", "--name", "nas", "--no-shell"},
		"--roots /x,/y a.example b.example":   {"--roots", "/x,/y", "--join", "a.example", "--join", "b.example"},
		"--name=nas https://a --agents codex": {"--name=nas", "--join", "https://a", "--agents", "codex"},
	} {
		if got := joinArgs(splitWords(in)); !slices.Equal(got, want) {
			t.Errorf("joinArgs(%q) = %q, want %q", in, got, want)
		}
	}
}

// The options as written into a service come back the same.
func TestServeArgs(t *testing.T) {
	in := []string{"--no-server", "--join", "https://a", "--join", "b.example", "--name", "nas", "--roots", "/x", "--agents", "claude,codex", "--no-shell"}
	var f runFlags
	fs := flag.NewFlagSet("t", flag.ContinueOnError)
	f.register(fs)
	if err := fs.Parse(in); err != nil {
		t.Fatal(err)
	}
	if got := f.serveArgs(); !slices.Equal(got, in) {
		t.Fatalf("serveArgs = %q", got)
	}
	tm, err := f.terms()
	if err != nil || !slices.Equal(tm.Addrs, []string{"https://a", "https://b.example"}) || !slices.Equal(tm.Agents, []string{"claude", "codex"}) || !tm.NoShell {
		t.Fatalf("terms %+v %v", tm, err)
	}
}

func splitWords(s string) []string {
	var out []string
	for _, w := range slices.Collect(func(yield func(string) bool) {
		start := -1
		for i, r := range s + " " {
			if r == ' ' {
				if start >= 0 && !yield(s[start:i]) {
					return
				}
				start = -1
			} else if start < 0 {
				start = i
			}
		}
	}) {
		out = append(out, w)
	}
	return out
}
