package executor

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/kumoSleeping/iridium/internal/remote/wire"
)

func TestGrant(t *testing.T) {
	root, other := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(other, "f"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	var asked []string
	var told []Denial
	answer := false
	e, err := New(Options{State: t.TempDir(), Roots: []string{root},
		Ask: func(_ context.Context, q string) bool {
			asked = append(asked, q)
			return answer
		},
		Denied: func(d Denial) { told = append(told, d) },
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	f := filepath.Join(other, "f")

	// Outside its roots: denied, the reason said, the terminal told once a minute.
	for range 2 {
		if _, err := e.read(f, 0, 10, fileRead{}); !wire.IsCode(err, wire.CodeDenied) || !strings.Contains(err.Error(), "not under the folders") {
			t.Fatalf("read outside the roots: %v", err)
		}
	}
	if len(told) != 1 || told[0] != (Denial{What: DeniedPath, Path: f}) {
		t.Fatalf("told %v", told)
	}
	if _, err := e.startRun(nil, wire.RunParams{Run: "r", Line: "id"}); !wire.IsCode(err, wire.CodeDenied) {
		t.Fatalf("a command line ran: %v", err)
	}
	if len(told) != 2 || told[1].What != DeniedShell {
		t.Fatalf("told %v", told)
	}

	// Declined there: nothing changes.
	yes := true
	if _, err := e.grant(ctx, wire.GrantParams{Shell: &yes, Roots: []string{other}, By: "kumo"}); !wire.IsCode(err, wire.CodeDenied) {
		t.Fatalf("declined grant: %v", err)
	}
	if len(asked) != 1 || !strings.Contains(asked[0], "kumo") || !strings.Contains(asked[0], "命令行") || !strings.Contains(asked[0], other) {
		t.Fatalf("asked %q", asked)
	}
	if e.Shell() || len(e.Roots()) != 1 {
		t.Fatal("a declined grant changed it")
	}

	// Allowed: the folder is served, command lines run, the hello says so.
	answer = true
	res, err := e.grant(ctx, wire.GrantParams{Shell: &yes, Roots: []string{other}})
	if err != nil {
		t.Fatal(err)
	}
	if g := res.(wire.Grant); !g.Shell || !slices.Equal(g.Roots, []string{root, other}) {
		t.Fatalf("grant %+v", g)
	}
	if _, err := e.read(f, 0, 10, fileRead{}); err != nil {
		t.Fatalf("read after the grant: %v", err)
	}
	if hi := e.hello(); !hi.ShellOn() || len(hi.Roots) != 2 || !slices.Contains(hi.Caps, wire.CapGrant) {
		t.Fatalf("hello %+v", hi)
	}

	// What it has already is not asked again; turning command lines off is not asked.
	n := len(asked)
	no := false
	if _, err := e.grant(ctx, wire.GrantParams{Shell: &no, Roots: []string{filepath.Join(other, "sub")}}); err != nil {
		t.Fatal(err)
	}
	if len(asked) != n || e.Shell() || len(e.Roots()) != 2 {
		t.Fatalf("asked %d more, shell %v, roots %v", len(asked)-n, e.Shell(), e.Roots())
	}
	if _, err := e.grant(ctx, wire.GrantParams{Roots: []string{"rel/dir"}}); !wire.IsCode(err, wire.CodeBadRequest) {
		t.Fatalf("a relative root: %v", err)
	}
}

// With no one at its terminal, or no answer in time, a grant of more is declined.
func TestGrantNoOne(t *testing.T) {
	yes := true
	e, err := New(Options{State: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.grant(context.Background(), wire.GrantParams{Shell: &yes}); !wire.IsCode(err, wire.CodeDenied) {
		t.Fatalf("no one asked: %v", err)
	}
	was := askFor
	askFor = 50 * time.Millisecond
	defer func() { askFor = was }()
	e.o.Ask = func(ctx context.Context, _ string) bool {
		<-ctx.Done()
		return true
	}
	if _, err := e.grant(context.Background(), wire.GrantParams{Shell: &yes}); !wire.IsCode(err, wire.CodeDenied) || e.Shell() {
		t.Fatalf("no answer: %v", err)
	}
}

// The folder an agent is installed in is read though no root holds it (kumo, 2026-11-18: dsh
// under /opt/homebrew would not start, the home alone served); never written.
func TestAgentScopeIsRead(t *testing.T) {
	root, scope := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(scope, "package.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	e, err := New(Options{State: t.TempDir(), Roots: []string{root}, Agents: []wire.AgentInfo{{Agent: "dsh", Scope: scope}}})
	if err != nil {
		t.Fatal(err)
	}
	f := filepath.Join(scope, "package.json")
	if _, err := e.read(f, 0, 10, fileRead{}); err != nil {
		t.Fatalf("read in an agent's scope: %v", err)
	}
	if _, err := e.list(scope, fileRead{}); err != nil {
		t.Fatalf("list an agent's scope: %v", err)
	}
	if err := e.write(filepath.Join(scope, "x"), []byte("x"), "", false); !wire.IsCode(err, wire.CodeDenied) {
		t.Fatalf("write in an agent's scope: %v", err)
	}
}
