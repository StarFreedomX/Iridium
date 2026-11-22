package desktop

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kumoSleeping/iridium/internal/remote/executor"
)

func TestSettings(t *testing.T) {
	t.Setenv("IR_APP_CONFIG", filepath.Join(t.TempDir(), "app.json"))
	t.Setenv("IRIDIUM_CONFIG", filepath.Join(t.TempDir(), "config.json"))
	// Nothing runs till asked for: no Iridium of its own, nothing joined.
	if !Fresh() || ServerOn() || Needed() {
		t.Fatal("fresh settings: something on")
	}
	if err := SetServer(true); err != nil || !ServerOn() || !Needed() {
		t.Fatalf("server on: %v", err)
	}
	if c, _ := loadConfig(); c.local() == nil || c.current() != c.local().URL {
		t.Fatalf("server on: not in the list, shown: %+v", c)
	}
	SetServer(false)
	if Needed() {
		t.Fatal("server off, nothing joined: still needed")
	}
	tm, _ := ParseTerms([]string{"a.example", "https://b.example"}, "nas", "", true, "")
	if err := Join(tm); err != nil || !Needed() {
		t.Fatal(err)
	}
	if got := Joined(); len(got) != 2 || got[0] != "https://a.example" {
		t.Fatalf("joined %q", got)
	}
	if err := Leave("a.example"); err != nil {
		t.Fatal(err)
	}
	if got := Joined(); len(got) != 1 || got[0] != "https://b.example" {
		t.Fatalf("after leave %q", got)
	}
	if Leave("c.example") == nil {
		t.Fatal("left one never joined")
	}
	SetServer(false)
	c, _ := loadConfig()
	if ServerOn() || c.Name != "nas" || !c.server("https://b.example").NoShell {
		t.Fatalf("settings %+v", c)
	}
	// The runtime joins neither this computer's own nor those left.
	if j := joinsOf(c); len(j.Servers) != 2 || j.Servers[0].Local {
		t.Fatalf("joinsOf %+v", j.Servers)
	}
}

// A request goes to the window as a file and its answer comes back; with no window, no.
func TestAskWindow(t *testing.T) {
	t.Setenv("IR_APP_CONFIG", filepath.Join(t.TempDir(), "app.json"))
	items := []executor.Item{{Kind: "shell"}, {Kind: "folder", Value: "/x"}}
	if got := askWindow(context.Background(), "s", "by", items); got[0] || got[1] {
		t.Fatal("no window, yet allowed")
	}
	w := &Record{Kind: "window"}
	w.save(nil)
	defer w.remove()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	go answerAsks(ctx, func(_ context.Context, server, by string, it []executor.Item) []bool {
		return []bool{server == "s" && by == "by", it[1].Value == "/x"}
	})
	got := askWindow(ctx, "s", "by", items)
	if !got[0] || !got[1] {
		t.Fatalf("answer %v", got)
	}
	d, _ := runDir()
	ents, _ := os.ReadDir(d)
	for _, e := range ents {
		if e.Name() != filepath.Base(d) && filepath.Ext(e.Name()) == ".json" {
			var r Record
			if b, _ := os.ReadFile(filepath.Join(d, e.Name())); json.Unmarshal(b, &r) != nil || r.Kind != "window" {
				t.Errorf("left behind: %s", e.Name())
			}
		}
	}
}
