package executor

import (
	"testing"

	"github.com/kumoSleeping/iridium/internal/remote/wire"
)

func TestNoShell(t *testing.T) {
	e := &Executor{o: Options{State: t.TempDir(), Agents: []wire.AgentInfo{{Agent: "dsh", Argv: []string{"/n/node", "/d/bin.js"}}}}, holds: map[string]*holder{}}
	if !e.agentArgv([]string{"/n/node", "/d/bin.js", "--profile", "sdk"}) {
		t.Error("the agent's own argv was refused")
	}
	for _, argv := range [][]string{{"/bin/sh", "-c", "id"}, {"/n/node"}, {"/n/node", "/x.js"}} {
		if e.agentArgv(argv) {
			t.Errorf("%q was taken", argv)
		}
	}
	if _, err := e.start("sh-1", spec{Argv: []string{"/bin/sh", "-c", "id"}}); !wire.IsCode(err, wire.CodeDenied) {
		t.Errorf("a command line started: %v", err)
	}
	if hi := e.hello(); hi.ShellOn() || !hi.NoShell || hi.AgentShell {
		t.Error("the hello does not say so")
	}
}

// Its owner turns things off at this computer (Set): an agent is no longer offered nor started,
// command lines stop, the folders narrow; at once.
func TestSet(t *testing.T) {
	logs := 0
	e, err := New(Options{State: t.TempDir(), Shell: true, Logf: func(string, ...any) { logs++ },
		Agents: []wire.AgentInfo{{Agent: "dsh", Argv: []string{"/n/node", "/d/bin.js"}}, {Agent: "codex", Argv: []string{"/c/codex"}}}})
	if err != nil {
		t.Fatal(err)
	}
	e.Set(false, []string{"/w"}, []string{"dsh"})
	hi := e.hello()
	if hi.ShellOn() || len(hi.Agents) != 1 || hi.Agents[0].Agent != "codex" || len(hi.Roots) != 1 {
		t.Fatalf("hello after Set: shell %v, agents %v, roots %v", hi.ShellOn(), hi.Agents, hi.Roots)
	}
	if _, err := e.start("h-1", spec{Argv: []string{"/n/node", "/d/bin.js"}}); !wire.IsCode(err, wire.CodeDenied) {
		t.Errorf("an agent turned off started: %v", err)
	}
	if _, err := e.start("sh-1", spec{Argv: []string{"/bin/sh", "-c", "id"}}); !wire.IsCode(err, wire.CodeDenied) {
		t.Errorf("a command line started: %v", err)
	}
	if !e.agentArgv([]string{"/c/codex", "exec"}) || e.agentArgv([]string{"/n/node", "/d/bin.js"}) {
		t.Error("which agents are on")
	}
	n := logs
	e.Set(false, []string{"/w"}, []string{"dsh"}) // the same: nothing done
	if logs != n {
		t.Error("the same terms set again were taken for a change")
	}
}
