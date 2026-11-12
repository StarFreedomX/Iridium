package deliver

import (
	"strings"
	"testing"
)

func TestMentions(t *testing.T) {
	nicks := []string{"claude", "claude2", "审稿"}
	for text, want := range map[string]string{
		"@claude look":                          "claude",
		"hi @Claude2, and @claude":              "claude2 claude",
		"@审稿 看一下":                               "审稿",
		"请@审稿看一下":                               "", // inside words: "审稿看一下" is not the nick
		"请 @审稿，看一下 @claude。":                    "审稿 claude",
		"mail me@claude.dev or a@claude":        "",
		"`@claude` and\n```\n@claude2\n```\nno": "",
		"> @claude said\nfine":                  "",
		"@claudette @nobody":                    "",
		"@claude @claude":                       "claude",
		"see https://x.dev/@claude":             "",
	} {
		if got := strings.Join(Mentions(text, nicks), " "); got != want {
			t.Errorf("%q: %q, want %q", text, got, want)
		}
	}
	for n, ok := range map[string]bool{"claude2": true, "审稿": true, "a b": false, "": false, "a@b": false, "x-y_z": true} {
		if ValidNick(n) != ok {
			t.Errorf("ValidNick(%q) != %v", n, ok)
		}
	}
}

func TestRoute(t *testing.T) {
	agents := []Agent{{"s1", "claude", true}, {"s2", "codex", false}, {"s3", "pi", true}}
	wake := func(d Decision) string { return strings.Join(d.Wake, " ") }
	// A person: whoever is named; nobody named, those that receive everything.
	if d := Route("hello", "", 0, agents); wake(d) != "s1 s3" {
		t.Errorf("a person, nobody named: %+v", d)
	}
	if d := Route("@codex hello", "", 0, agents); wake(d) != "s2" || len(d.Named) != 1 {
		t.Errorf("a person naming one: %+v", d)
	}
	// An agent: only whom it names, never itself, never by merely speaking.
	if d := Route("done", "s1", 0, agents); wake(d) != "" {
		t.Errorf("an agent speaking: %+v", d)
	}
	if d := Route("@codex and @claude", "s1", 1, agents); wake(d) != "s2" {
		t.Errorf("an agent naming: %+v", d)
	}
	if d := Route("@codex go on", "s1", MaxHops, agents); !d.TooFar || wake(d) != "" {
		t.Errorf("too far: %+v", d)
	}
	if d := Route("no names", "s1", MaxHops, agents); d.TooFar {
		t.Errorf("too far without a name: %+v", d)
	}
}
