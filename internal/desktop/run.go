package desktop

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"github.com/kumoSleeping/iridium/internal/remote/wire"
)

// Options are what one start of iridium was given on its command line (docs/app.md "启动参数"):
// everything is on unless taken off; joins are added.
type Options struct {
	NoServer bool  // no Iridium of this computer's own (the window: not started, nor put in the list)
	Join     Terms // the Iridiums to join besides
}

// Terms are what --join's Iridiums may do here: the same for each of them.
type Terms struct {
	Addrs   []string // --join, normalized
	Name    string   // this computer's name there; "": the host name
	Roots   []string // the only folders served (absolute); none: all
	NoShell bool     // no command lines
	Agents  []string // the only agents started; none: all
}

// ParseTerms makes Terms of the flags' words: addresses normalized, folders made absolute.
func ParseTerms(addrs []string, name, roots string, noShell bool, agents string) (Terms, error) {
	t := Terms{Name: name, NoShell: noShell}
	for _, a := range addrs {
		n, err := normalize(a)
		if err != nil {
			return t, err
		}
		if !slices.Contains(t.Addrs, n) {
			t.Addrs = append(t.Addrs, n)
		}
	}
	for _, r := range strings.Split(roots, ",") {
		if r = strings.TrimSpace(r); r != "" {
			abs, err := filepath.Abs(r)
			if err != nil {
				return t, err
			}
			t.Roots = append(t.Roots, abs)
		}
	}
	for _, a := range strings.Split(agents, ",") {
		if a = strings.TrimSpace(a); a != "" {
			t.Agents = append(t.Agents, a)
		}
	}
	return t, nil
}

// server is the list's entry for address under these terms, joined.
func (t Terms) server(address string, agents []wire.AgentInfo) Server {
	s := Server{URL: address, NoShell: t.NoShell, Roots: t.Roots}
	if len(t.Agents) > 0 {
		for _, a := range agents {
			if !slices.Contains(t.Agents, a.Agent) {
				s.AgentsOff = append(s.AgentsOff, a.Agent)
			}
		}
	}
	return s
}

// RunJoins joins t's Iridiums till ctx ends, with no window (iridium serve --join): a grant one
// of them asks for is asked at the terminal it runs in, and with none (a service) turned down.
// update: the executor follows its Iridium's release (no server of this computer's runs in the
// same process to update the binary).
func RunJoins(ctx context.Context, t Terms, update bool, logf func(string, ...any)) error {
	if len(t.Addrs) == 0 {
		return fmt.Errorf("no Iridium to join")
	}
	j := &Joins{Terminal: true, Logf: logf, Update: update}
	for _, a := range t.Agents {
		if !slices.ContainsFunc(j.Agents(), func(i wire.AgentInfo) bool { return i.Agent == a }) {
			logf("--agents %s: not found here", a)
		}
	}
	c := Config{Name: t.Name}
	for _, a := range t.Addrs {
		c.Servers = append(c.Servers, t.server(a, j.Agents()))
	}
	j.Record = &Record{Kind: "serve"}
	j.Sync(c)
	<-ctx.Done()
	j.Stop()
	return nil
}
