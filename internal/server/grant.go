package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/gate"
	"github.com/kumoSleeping/iridium/internal/remote"
	"github.com/kumoSleeping/iridium/internal/remote/wire"
	"github.com/kumoSleeping/iridium/internal/webapp"
)

// What a computer turned down, and a person widening it (docs/exec.md "放开"): an agent's request
// that met a path outside the computer's folders, or command lines off there, becomes a card in
// its session (a machine_grant need) and a line at that computer's terminal. Allowed on the page,
// the computer asks the person at its terminal (wire's grant); only a yes there widens it.

// grantWait is how long a grant waits for the person at the computer's terminal: within what a
// proxy lets a request take (Cloudflare's 100 s), longer than the executor asks for.
const grantWait = 90 * time.Second

// callerAt is the caller a request's context carries (callerOf's).
func callerAt(ctx context.Context) caller {
	if c, ok := ctx.Value(callerKey{}).(caller); ok {
		return c
	}
	id, _ := gate.FromContext(ctx)
	c := caller{Identity: id, agent: id.Session != "", session: id.Session}
	if id.Web() {
		c.web = webapp.SessionOf(ctx)
	}
	return c
}

// watchDenials: what the executors turn down (remote.Hub.Denied) is told as machineDenied does.
func (s *Server) watchDenials() {
	if s.Remote == nil {
		return
	}
	s.Remote.Denied = func(ctx context.Context, machine, method, p string) {
		dir := p
		if method != "fs.list" && method != "fs.mkdir" {
			dir = parentOf(p)
		}
		s.machineDenied(ctx, machine, false, dir)
	}
}

// parentOf is p's folder, by either separator (a path at a Windows computer has \).
func parentOf(p string) string {
	i := strings.LastIndexAny(p, `/\`)
	switch {
	case i < 0:
		return p
	case i == 0:
		return p[:1]
	case i == 2 && p[1] == ':':
		return p[:3]
	}
	return p[:i]
}

// machineDenied: machine turned down an agent's request in a session, for command lines (shell)
// or for folder dir: its session gets a card to allow it, unless one waits already. Command lines
// are told at the computer's terminal too (paths it tells by itself).
func (s *Server) machineDenied(ctx context.Context, machine string, shell bool, dir string) bool {
	c := callerAt(ctx)
	name := machine
	if info, ok := s.gate().Endpoint(machine); ok {
		name = info.Name
	}
	if shell && s.Remote != nil {
		if mc := s.Remote.Find(machine); mc != nil && mc.Has(wire.CapGrant) {
			by := c.Name
			if c.session != "" {
				by = "会话「" + s.sessionTitle(c.session) + "」"
			}
			nctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			_ = mc.Notify(nctx, wire.EventDenied, wire.DeniedEvent{What: "shell", By: by})
			cancel()
		}
	}
	if c.session == "" || (!shell && dir == "") {
		return false
	}
	for _, n := range s.asks.pending().Pending {
		if n.Kind == api.NeedMachineGrant && n.Session == c.session && n.Machine == machine && n.Shell == shell && n.Path == dir {
			return true
		}
	}
	n := s.asks.addNeed(api.Need{Kind: api.NeedMachineGrant, Name: name, Asker: c.Name, Session: c.session, Machine: machine, Shell: shell, Path: dir})
	s.logf("server: %s was turned down at %s (shell %v, %q): need %s", c.Name, name, shell, dir, n.ID)
	return true
}

// sessionTitle is session id's name as a person reads it; its id's start if none.
func (s *Server) sessionTitle(id string) string {
	if st, err := s.m.State(id); err == nil && st != nil {
		if st.Name != "" {
			return st.Name
		}
		if st.Title != "" {
			return st.Title
		}
	}
	return id[:min(8, len(id))]
}

// grantNeed allows a machine_grant need: the computer asks the person at its terminal.
func (s *Server) grantNeed(ctx context.Context, n api.Need, by string) error {
	p := wire.GrantParams{By: by}
	if n.Shell {
		on := true
		p.Shell = &on
	}
	if n.Path != "" {
		p.Roots = []string{n.Path}
	}
	_, err := s.grantAt(ctx, n.Machine, p)
	return err
}

// errGrantDeclined: the person at the computer said no, or was not there to say.
var errGrantDeclined = errors.New("not allowed at that computer: declined, or no one answered there")

// grantAt asks machine for p, waiting up to grantWait for the person there.
func (s *Server) grantAt(ctx context.Context, machine string, p wire.GrantParams) (wire.Grant, error) {
	if s.Remote == nil {
		return wire.Grant{}, wire.ErrOffline
	}
	mc := s.Remote.Find(machine)
	if mc == nil {
		return wire.Grant{}, wire.ErrOffline
	}
	ctx, cancel := context.WithTimeout(ctx, grantWait)
	defer cancel()
	g, err := mc.Grant(ctx, p)
	if wire.IsCode(err, wire.CodeDenied) || errors.Is(err, context.DeadlineExceeded) {
		err = errGrantDeclined
	}
	if err == nil {
		s.logf("server: %s: granted shell %v, roots %s", machine, g.Shell, strings.Join(g.Roots, ", "))
	}
	return g, err
}

// postGrant is POST /v1/internal/machines/{id}/grant: a person widens (asked at that computer) or
// narrows what a computer lets this Iridium do (api.MachineGrant); its answer is the computer as
// listed after.
func (s *Server) postGrant(w http.ResponseWriter, r *http.Request) {
	var req api.MachineGrant
	if !readJSON(w, r, &req) {
		return
	}
	id := r.PathValue("id")
	if s.Remote != nil {
		if mc := s.Remote.Find(id); mc != nil {
			id = mc.ID()
		}
	}
	for _, root := range req.Roots {
		if root == "" || !remote.IsAbs(sepOf(root), root) {
			refuse(w, http.StatusUnprocessableEntity, "bad_path", "a whole path there: "+root)
			return
		}
	}
	c := callerOf(r)
	_, err := s.grantAt(r.Context(), id, wire.GrantParams{Shell: req.Shell, Roots: req.Roots, By: c.Name})
	switch {
	case errors.Is(err, errGrantDeclined):
		refuse(w, http.StatusForbidden, "declined", err.Error())
		return
	case errors.Is(err, remote.ErrNoGrant):
		refuse(w, http.StatusUnprocessableEntity, "no_grant", err.Error())
		return
	case errors.Is(err, wire.ErrOffline):
		fail(w, http.StatusConflict, "machine not connected")
		return
	case err != nil:
		s.remoteError(w, err)
		return
	}
	m := s.computerOf(id)
	if m == nil {
		refuse(w, http.StatusUnprocessableEntity, "no_such_app", "no such computer")
		return
	}
	reply(w, http.StatusOK, m)
}

// sepOf is the separator a whole path p is written with.
func sepOf(p string) string {
	if strings.HasPrefix(p, "/") {
		return "/"
	}
	return `\`
}

// noShellText is what an agent reads when command lines are off at machine (name): a card in its
// session asks a person (asked).
func noShellText(name string, asked bool) string {
	t := fmt.Sprintf("command lines do not run on %s: its owner turned them off", name)
	if asked {
		t += "; a card in this session asks a person to allow them (confirmed at that computer): tell the user, and try again once allowed"
	}
	return t
}
