package server

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/kumoSleeping/iridium/internal/access"
	"github.com/kumoSleeping/iridium/internal/activity"
	"github.com/kumoSleeping/iridium/internal/agent"
	"github.com/kumoSleeping/iridium/internal/agents"
	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/channel"
	"github.com/kumoSleeping/iridium/internal/ctx/assemble"
	"github.com/kumoSleeping/iridium/internal/ctx/strategy"
	"github.com/kumoSleeping/iridium/internal/deliver"
	"github.com/kumoSleeping/iridium/internal/gate"
	"github.com/kumoSleeping/iridium/internal/satori"
	"github.com/kumoSleeping/iridium/internal/session"
	"github.com/kumoSleeping/iridium/internal/store"
)

// Channels of several agents (docs/channels.md): who is in one, and where a message said there
// goes. A session's channel with its own agent alone is the session it always was (sendAs). With
// other sessions in it (subscriptions: they see what is said and speak with ir), a message is
// said in the channel and given only to the agents the rules wake (package deliver): each gets
// the words under their number and what the channel said since it last read it (package
// strategy plans it, assemble writes it, and what was given is kept: store.Injection).

// MaxAgents is how many agents a channel may have.
const MaxAgents = 8

// chain is the chain a session's turn is in: who began it, and how many agents passed it on.
type chain struct {
	origin string
	hop    int
}

type chains struct {
	mu    sync.Mutex
	of    map[string]chain
	locks map[string]*sync.Mutex // a session is given one message at a time
}

func (c *chains) lock(session string) func() {
	c.mu.Lock()
	if c.locks == nil {
		c.locks = map[string]*sync.Mutex{}
	}
	l := c.locks[session]
	if l == nil {
		l = &sync.Mutex{}
		c.locks[session] = l
	}
	c.mu.Unlock()
	l.Lock()
	return l.Unlock
}

func (c *chains) get(session string) chain {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.of[session]
}

func (c *chains) set(session string, ch chain) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.of == nil {
		c.of = map[string]chain{}
	}
	c.of[session] = ch
}

// called is a channel an agent was called in by a subscription: for message seq; spoke, it has
// said something there since.
type called struct {
	channel string
	seq     int64
	spoke   bool
	// from: the line its own record was at when it was called: where what it does for the call
	// begins.
	from int64
}

// calls are the calls each session's agent has open: made as it is given a channel's message,
// closed as its turn ends (turnEnded).
type calls struct {
	mu sync.Mutex
	of map[string][]called
}

func (k *calls) add(session string, c called) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.of == nil {
		k.of = map[string][]called{}
	}
	k.of[session] = append(k.of[session], c)
}

// spoke: session's agent said something in channel, its record at line to by then. It gives
// the line the stretch that led to it began at (0: not called there), and the next begins at to.
func (k *calls) spoke(session, channel string, to int64) (from int64) {
	k.mu.Lock()
	defer k.mu.Unlock()
	for i := range k.of[session] {
		if c := &k.of[session][i]; c.channel == channel {
			if from == 0 || c.from < from {
				from = c.from
			}
			c.spoke, c.from = true, to
		}
	}
	return from
}

// take are session's open calls, which are then closed.
func (k *calls) take(session string) []called {
	k.mu.Lock()
	defer k.mu.Unlock()
	out := k.of[session]
	delete(k.of, session)
	return out
}

// turnEnded: a turn of session's agent ended with reply. In each channel it was called in by a
// subscription and said nothing: where it has no ir to speak with (another machine's, without
// one), its reply is said there for it; else the channel is told it said nothing.
func (s *Server) turnEnded(id, reply string) {
	open := s.calls.take(id)
	if len(open) == 0 {
		return
	}
	done := map[string]bool{}
	for _, c := range open {
		if c.spoke || done[c.channel] || !s.ch.Speaks(c.channel, id) {
			continue
		}
		done[c.channel] = true
		if !s.m.HasIR(id) && strings.TrimSpace(reply) != "" {
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			_, err := s.sendChannelAs(ctx, caller{Identity: localIdentity, socket: true, agent: true, session: id}, session.From(gate.HostID, "@"+s.ch.Nick(id)), c.channel, api.Send{Text: reply}, false)
			cancel()
			if err == nil {
				continue
			}
			s.logf("server: channel %s: saying %s's reply: %v", c.channel, id, err)
		}
		nick := s.ch.Nick(id)
		s.sat.Note(c.channel, fmt.Sprintf("@%s 被叫起（#%d），未在频道发话", nick, c.seq), "", &channel.Event{Type: "silent", Member: store.AgentMember(id), Nick: nick, Seq: c.seq})
		// Started by another agent for this channel: that one is told too.
		if sp := s.spawnedOf(id); sp != nil && sp.By != "" && sp.By != id && sp.Channel == c.channel {
			if in, err := assemble.ChannelSilent(nick, cmp.Or(s.channelName(c.channel), c.channel), c.seq); err == nil {
				ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				if _, _, err := s.m.SendAs(ctx, sp.By, session.NewInputID(), in.String(), session.From(gate.HostID, "Iridium"), true); err != nil {
					s.logf("server: channel %s: telling %s that %s said nothing: %v", c.channel, sp.By, id, err)
				}
				cancel()
			}
		}
	}
}

func (s *Server) channelRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/internal/channels/{id}/members", s.membersGet)
	mux.HandleFunc("POST /v1/internal/channels/{id}/members", s.memberAdd)
	mux.HandleFunc("PATCH /v1/internal/channels/{id}/members/{member}", s.memberPatch)
	mux.HandleFunc("DELETE /v1/internal/channels/{id}/members/{member}", s.memberRemove)
	mux.HandleFunc("PUT /v1/internal/channels/{id}/people", s.peoplePut)
	mux.HandleFunc("POST /v1/internal/channels/{id}/follow", s.followAdd)
	mux.HandleFunc("GET /v1/internal/channels/{id}/reads", s.readsGet)
	mux.HandleFunc("POST /v1/internal/channels/{id}/read", s.readPost)
	mux.HandleFunc("GET /v1/internal/agents/{agent}/choices", s.agentChoices)
	mux.HandleFunc("GET /v1/internal/sessions/{id}/injections", s.use(s.injections))
}

// channelOf is what the list of sessions marks session id with: the agents of its channel, where
// it has several (its own first), and the channels it is in beside its own.
func (s *Server) channelOf(id string) (agents []api.ChannelAgent, in []string) {
	ms, _ := s.ch.Members(id)
	for _, m := range ms {
		if m.Agent() {
			agents = append(agents, api.ChannelAgent{Session: m.Session, Nick: m.Nick})
		}
	}
	if len(agents) < 2 {
		agents = nil
	}
	return agents, s.ch.In(id)
}

// membersChanged tells the pages a channel's members changed: the list of sessions again, and
// the state "channels" (a number that only goes up; a page reads the members again).
func (s *Server) membersChanged() {
	s.hub.Set("channels", s.channelsSeq.Add(1))
	s.m.PublishList()
}

// errNotMember: the caller sees the channel but is not one of its people.
var errNotMember = &access.Denied{Reason: "not one of this channel's people: it can be read, not spoken in"}

// inChannel checks that c is one of the people of channel ch (docs/channels.md "人"): the host
// always; an agent of the channel; else the caller's login, as the channel's people name it.
// Whoever is not may still read.
func (s *Server) inChannel(c caller, ch string) error {
	if c.Host() && !c.agent && c.session == "" {
		return nil
	}
	if s.ch.Speaks(ch, cmp.Or(c.session, c.Session)) {
		return nil
	}
	if s.ch.Has(ch, c.App, c.Login) {
		return nil
	}
	return errNotMember
}

// memberOf is the member c is as a login.
func memberOf(c caller) string {
	if c.Login == "" {
		return channel.AppMember(c.App)
	}
	return channel.PersonMember(c.App, c.Login)
}

// harnessOf names session's harness, for a nick.
func (s *Server) harnessOf(id string) string {
	st, err := s.m.State(id)
	if err != nil {
		return ""
	}
	return string(st.Agent)
}

// multi: channel ch has more than one agent, or is no session's: what is said in it is given
// to its agents by the rules, not to one session.
func (s *Server) multi(ch string) bool {
	if _, own := s.ch.Own(ch); own {
		return true
	}
	return len(s.ch.Agents(ch)) > 1
}

// seeingChannel is the channel ch names (its id, the start of it, or self: the caller's own) if
// c sees it.
func (s *Server) seeingChannel(c caller, ch string) (string, *api.SessionState, error) {
	ch, err := s.sessionArg(context.Background(), c, ch)
	if err != nil {
		return "", nil, err
	}
	st, err := s.m.State(ch)
	if err != nil {
		return "", nil, err
	}
	if !c.Host() && !s.sees(s.permsFor(c), st.Session) {
		return "", nil, errNoSession
	}
	return ch, st, nil
}

// membersOf are channel ch's members as the API gives them.
func (s *Server) membersOf(c caller, ch string) (api.ChannelMembers, error) {
	ms, err := s.ch.Members(ch)
	if err != nil {
		return api.ChannelMembers{}, err
	}
	out := api.ChannelMembers{Channel: ch, Members: []api.ChannelMember{}, Joined: s.inChannel(c, ch) == nil, Me: memberOf(c)}
	n := 0
	for _, m := range ms {
		am := api.ChannelMember{Member: m.Member, Session: m.Session, Nick: m.Nick, Recv: m.Recv, Send: m.Send, Seen: m.Seen}
		if m.Agent() {
			n++
			if st, err := s.m.State(m.Session); err == nil {
				info, _ := agents.Get(st.Agent)
				am.Agent, am.Status, am.Cwd, am.Machine = st.Agent, st.Status, st.Cwd, st.Machine
				s.keepChoices(st)
				am.Name = satori.AgentName(cmp.Or(info.Name, string(st.Agent)), *st)
			}
		}
		out.Members = append(out.Members, am)
	}
	out.Multi = n > 1
	return out, nil
}

func (s *Server) membersGet(w http.ResponseWriter, r *http.Request) {
	c := callerOf(r)
	ch, _, err := s.seeingChannel(c, r.PathValue("id"))
	if err != nil {
		s.error(w, err)
		return
	}
	out, err := s.membersOf(c, ch)
	if err != nil {
		s.fault(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

// memberFault answers with a membership's error.
func (s *Server) memberFault(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errFull):
		refuse(w, http.StatusConflict, "full", err.Error())
	case errors.Is(err, channel.ErrNick), errors.Is(err, channel.ErrRecv), errors.Is(err, channel.ErrPeople):
		refuse(w, http.StatusBadRequest, "bad_request", err.Error())
	case errors.Is(err, channel.ErrNoMember):
		refuse(w, http.StatusUnprocessableEntity, "no_such_member", err.Error())
	case errors.Is(err, channel.ErrMember):
		refuse(w, http.StatusConflict, "member", err.Error())
	default:
		s.error(w, err)
	}
}

// memberAdd puts an agent in the channel: a session there is (Session), or a new one started
// for it. Whoever may use that session, or start that agent there, may add it: a person, or an
// agent of the channel (ir).
func (s *Server) memberAdd(w http.ResponseWriter, r *http.Request) {
	c := callerOf(r)
	ch, st, err := s.seeingChannel(c, r.PathValue("id"))
	if err != nil {
		s.error(w, err)
		return
	}
	if err := s.inChannel(c, ch); err != nil {
		s.error(w, err)
		return
	}
	var req api.NewMember
	if !readJSON(w, r, &req) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	id, err := s.addAgent(ctx, c, ch, st, req)
	if err != nil {
		s.memberFault(w, err)
		return
	}
	if m, ok := s.memberRow(ch, store.AgentMember(id)); ok {
		s.tellMembers(c, ch, fmt.Sprintf("@%s 加入了频道", m.Nick), channel.Event{Type: "join", Member: m.Member, Nick: m.Nick, Name: s.agentName(id)})
	}
	out, err := s.membersOf(c, ch)
	if err != nil {
		s.fault(w, err)
		return
	}
	s.membersChanged()
	reply(w, http.StatusOK, out)
}

// addAgent puts an agent in channel ch (st: the channel's state) as c: session req.Session,
// which c may use, else a new session of req.Agent, started in req.Cwd at req.Machine (none:
// the channel's folder) as any session is: listed in its folder, with a channel of its own.
// Where it was started and by whom is kept (Spawned). The session it is.
func (s *Server) addAgent(ctx context.Context, c caller, ch string, st *api.SessionState, req api.NewMember) (string, error) {
	if len(s.ch.Agents(ch)) >= MaxAgents {
		return "", errFull
	}
	if req.Nick != "" && !deliver.ValidNick(req.Nick) {
		return "", channel.ErrNick
	}
	id, started := req.Session, false
	if id != "" {
		full, err := s.sessionArg(ctx, c, id)
		if err != nil {
			return "", err
		}
		id = full
		if _, err := s.using(c, id); err != nil {
			return "", err
		}
		if s.ch.Speaks(ch, id) {
			return "", channel.ErrMember
		}
	} else {
		ns := api.NewSession{Agent: req.Agent, Cwd: cmp.Or(req.Cwd, st.Cwd), Machine: st.Machine, Model: req.Model, Mode: req.Mode,
			Effort: req.Effort, Preset: req.Preset}
		if req.Cwd != "" {
			ns.Machine = req.Machine
		}
		var err error
		if id, err = s.createAs(ctx, c, ns); err != nil {
			return "", err
		}
		started = true
		s.keepSpawned(id, api.Spawned{By: c.session, Channel: ch})
	}
	if req.Nick != "" {
		if err := s.ch.SetNick(id, req.Nick); err != nil {
			if started {
				_ = s.m.ArchiveTree(ctx, id, true)
			}
			return "", err
		}
	}
	m, err := s.ch.Join(ch, id, req.Recv, s.harnessOf)
	if err != nil {
		if started {
			_ = s.m.ArchiveTree(ctx, id, true)
		}
		return "", err
	}
	s.logf("server: channel %s: %s joined as @%s (%s)", ch, id, m.Nick, m.Recv)
	s.m.Refresh([]string{ch, id})
	return id, nil
}

// bareChannels are the channels that are no session's, each as the list of sessions has it: no
// agent, in its folder, last active when something was last said in it.
func (s *Server) bareChannels() []api.Session {
	var out []api.Session
	for _, c := range s.ch.Owns() {
		out = append(out, api.Session{ID: c.ID, Cwd: c.Cwd, Machine: c.Machine, Title: c.Name, Status: api.StatusIdle, Bare: true,
			UpdatedAt: max(c.Created, s.st.ChannelTouched(c.ID))})
	}
	return out
}

// createChannel makes a channel that is no session's as c (channel.create with no agent): in
// req.Cwd, with the people and agents req.Members names; then req.Text, its first words, said
// in it. Whoever may see that folder may make one there.
func (s *Server) createChannel(ctx context.Context, c caller, req api.NewSession) (string, error) {
	if !c.Host() {
		app := gate.HostID
		if req.Machine != "" {
			if info, ok := s.gate().Find(req.Machine); ok {
				app = info.ID
			}
		}
		if !s.scopeHas(s.permsFor(c).Scope, app, req.Cwd) {
			return "", &access.Denied{Reason: fmt.Sprintf("%s is out of this one's scope", req.Cwd)}
		}
	}
	setup := api.ChannelSetup{}
	if req.Members != nil {
		setup = *req.Members
	}
	if len(setup.Agents) > MaxAgents {
		return "", &createError{errFull}
	}
	for _, a := range setup.Agents {
		if a.Nick != "" && !deliver.ValidNick(a.Nick) {
			return "", &createError{fmt.Errorf("%w: %w", session.ErrBadRequest, channel.ErrNick)}
		}
	}
	id := session.NewChannelID()
	if err := s.ch.Create(store.Channel{ID: id, Cwd: req.Cwd, Machine: req.Machine, Creator: c.ID()}); err != nil {
		return "", &createError{err}
	}
	if err := s.m.ListBare(id, req.Cwd, req.Caller); err != nil {
		s.logf("server: channel %s: listing it: %v", id, err)
	}
	if req.Workspace != 0 {
		if err := s.st.Assign(id, req.Workspace, true); err != nil {
			s.logf("server: channel %s: its group: %v", id, err)
		}
	}
	setup.Nick, setup.Recv = "", ""
	err := s.setUp(ctx, c, id, setup, req.Text)
	s.m.Refresh([]string{id})
	return id, err
}

// spawnedKey is where what is kept of a session started for a channel is.
func spawnedKey(id string) string { return "spawned:" + id }

// keepSpawned keeps where session id was started and by whom.
func (s *Server) keepSpawned(id string, sp api.Spawned) {
	b, err := json.Marshal(sp)
	if err == nil {
		err = s.st.Keep(spawnedKey(id), string(b))
	}
	if err != nil {
		s.logf("server: keeping where %s was started: %v", id, err)
	}
}

// spawnedOf is where session id was started and by whom, if it was started for a channel.
func (s *Server) spawnedOf(id string) *api.Spawned {
	kept := s.st.Kept(spawnedKey(id))
	if kept == "" {
		return nil
	}
	var sp api.Spawned
	if json.Unmarshal([]byte(kept), &sp) != nil {
		return nil
	}
	return &sp
}

var errFull = fmt.Errorf("a channel has at most %d agents", MaxAgents)

// peoplePut sets who the channel's people are; the one who sets them stays one.
func (s *Server) peoplePut(w http.ResponseWriter, r *http.Request) {
	c := callerOf(r)
	ch, _, err := s.seeingChannel(c, r.PathValue("id"))
	if err != nil {
		s.error(w, err)
		return
	}
	if c.agent {
		forbid(w, errors.New("an agent's ir may not change a channel's people"))
		return
	}
	if err := s.inChannel(c, ch); err != nil {
		s.error(w, err)
		return
	}
	var req api.People
	if !readJSON(w, r, &req) {
		return
	}
	before := s.ch.People(ch)
	if err := s.setPeople(c, ch, req.People); err != nil {
		s.memberFault(w, err)
		return
	}
	after := s.ch.People(ch)
	ev := channel.Event{Type: "people", Everyone: slices.Contains(after, channel.Everyone)}
	for _, p := range after {
		// The host is one always: its own entry (it chose the people) is not news.
		if !slices.Contains(before, p) && p != channel.Everyone && !strings.HasPrefix(p, gate.HostID+"/") {
			ev.Added = append(ev.Added, p)
		}
	}
	for _, p := range before {
		if !slices.Contains(after, p) && p != channel.Everyone && !strings.HasPrefix(p, gate.HostID+"/") {
			ev.Removed = append(ev.Removed, p)
		}
	}
	if ev.Everyone != slices.Contains(before, channel.Everyone) || len(ev.Added)+len(ev.Removed) > 0 {
		text := "成员改为所有人"
		if !ev.Everyone {
			text = fmt.Sprintf("成员改为 %d 人", len(after))
		}
		s.tellMembers(c, ch, text, ev)
	}
	s.membersChanged()
	out, err := s.membersOf(c, ch)
	if err != nil {
		s.fault(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

// setUp makes new session id the channel setup says: its people, its own agent's nick and what
// it receives, the other agents; then first, its first words, said in it. An agent that cannot
// be started leaves the channel without it, and the error says so.
func (s *Server) setUp(ctx context.Context, c caller, id string, setup api.ChannelSetup, first string) error {
	st, err := s.m.State(id)
	if err != nil {
		return err
	}
	if err := s.setPeople(c, id, setup.People); err != nil {
		return fmt.Errorf("%w: %w", session.ErrBadRequest, err)
	}
	var failed error
	if setup.Nick != "" || setup.Recv != "" {
		var nick, recv *string
		if setup.Nick != "" {
			nick = &setup.Nick
		}
		if setup.Recv != "" {
			recv = &setup.Recv
		}
		if _, err := s.ch.Change(id, store.AgentMember(id), nick, recv, s.harnessOf); err != nil {
			failed = cmp.Or(failed, err)
		}
	}
	for _, a := range setup.Agents {
		if _, err := s.addAgent(ctx, c, id, st, a); err != nil {
			s.logf("server: channel %s: adding %s: %v", id, a.Agent, err)
			failed = cmp.Or(failed, fmt.Errorf("%s: %w", a.Agent, err))
		}
	}
	s.membersChanged()
	if strings.TrimSpace(first) != "" {
		if _, err := s.sendAs(ctx, c, s.fromOf(c, ""), id, api.Send{Text: first}); err != nil {
			return err
		}
	}
	return failed
}

// choicesTried is how many sessions of a kind are asked for their models, the latest first.
const choicesTried = 30

// agentChoices is what a new agent of kind {agent} may be started with: at ?machine= (none:
// here), or where ?channel= runs. No harness lists its models before it runs, so they are those
// the latest hosted session of the kind there has.
func (s *Server) agentChoices(w http.ResponseWriter, r *http.Request) {
	c := callerOf(r)
	kind, machine := api.Agent(r.PathValue("agent")), r.URL.Query().Get("machine")
	if ch := r.URL.Query().Get("channel"); ch != "" {
		_, st, err := s.seeingChannel(c, ch)
		if err != nil {
			s.error(w, err)
			return
		}
		machine = st.Machine
	}
	out := api.AgentChoices{Models: []api.Model{}, Efforts: []string{}}
	list, err := s.m.List(r.Context())
	if err != nil {
		s.fault(w, err)
		return
	}
	tried := 0
	for _, ss := range list {
		if ss.Agent != kind || !ss.Hosted || ss.Machine != machine || (!c.Host() && !s.sees(s.permsFor(c), ss)) {
			continue
		}
		if tried++; tried > choicesTried {
			break
		}
		if st, err := s.m.State(ss.ID); err == nil && len(st.Models)+len(st.Efforts) > 0 {
			out.Models, out.Efforts = append(out.Models, st.Models...), append(out.Efforts, st.Efforts...)
			s.keepChoices(st)
			break
		}
	}
	// Some harnesses say their models only while they run: what one said last is kept
	// (keepChoices), for when none of the kind runs.
	if len(out.Models)+len(out.Efforts) == 0 {
		if kept := s.st.Kept(choicesKey(kind, machine)); kept != "" {
			_ = json.Unmarshal([]byte(kept), &out)
		}
	}
	reply(w, http.StatusOK, out)
}

func choicesKey(kind api.Agent, machine string) string {
	return "choices:" + string(kind) + ":" + machine
}

// keepChoices keeps the models and efforts session st says its kind has where it runs, if it
// says any and they are not those kept.
func (s *Server) keepChoices(st *api.SessionState) {
	if len(st.Models)+len(st.Efforts) == 0 {
		return
	}
	b, err := json.Marshal(api.AgentChoices{Models: append([]api.Model{}, st.Models...), Efforts: append([]string{}, st.Efforts...)})
	if key := choicesKey(st.Agent, st.Machine); err == nil && s.st.Kept(key) != string(b) {
		if err := s.st.Keep(key, string(b)); err != nil {
			s.logf("server: keeping the choices of %s: %v", st.Agent, err)
		}
	}
}

// memberRow is member of channel ch as written.
func (s *Server) memberRow(ch, member string) (channel.Member, bool) {
	ms, _ := s.ch.Members(ch)
	for _, m := range ms {
		if m.Member == member {
			return m, true
		}
	}
	return channel.Member{}, false
}

// agentName is what session id's agent runs as now.
func (s *Server) agentName(id string) string {
	st, err := s.m.State(id)
	if err != nil {
		return ""
	}
	info, _ := agents.Get(st.Agent)
	return satori.AgentName(cmp.Or(info.Name, string(st.Agent)), *st)
}

// tellMembers says in channel ch that its members changed: a line of Iridium's own (text, for
// those that only read words) with ev, which c did.
func (s *Server) tellMembers(c caller, ch, text string, ev channel.Event) {
	ev.By = s.satoriUser(c).Name
	s.sat.Note(ch, text, c.ID(), &ev)
}

// setPeople makes people channel ch's, c with them (the host is one always).
func (s *Server) setPeople(c caller, ch string, people []string) error {
	if len(people) > 0 && !slices.Contains(people, channel.Everyone) && !c.Host() {
		if me := memberOf(c); !slices.Contains(people, me) && !slices.Contains(people, channel.AppMember(c.App)) {
			people = append(people, me)
		}
	}
	return s.ch.SetPeople(ch, people, s.harnessOf)
}

func (s *Server) memberPatch(w http.ResponseWriter, r *http.Request) {
	c := callerOf(r)
	ch, _, err := s.seeingChannel(c, r.PathValue("id"))
	if err != nil {
		s.error(w, err)
		return
	}
	if err := s.inChannel(c, ch); err != nil {
		s.error(w, err)
		return
	}
	var p api.MemberPatch
	if !readJSON(w, r, &p) {
		return
	}
	// An agent's ir changes what the agent itself receives there, nothing else.
	if c.agent && (r.PathValue("member") != store.AgentMember(c.session) || p.Nick != nil) {
		forbid(w, errors.New("an agent's ir changes only what it receives itself (recv)"))
		return
	}
	was, _ := s.memberRow(ch, r.PathValue("member"))
	now, err := s.ch.Change(ch, r.PathValue("member"), p.Nick, p.Recv, s.harnessOf)
	if err != nil {
		s.memberFault(w, err)
		return
	}
	if was.Nick != "" && now.Nick != was.Nick {
		s.tellMembers(c, ch, fmt.Sprintf("@%s 改名为 @%s", was.Nick, now.Nick), channel.Event{Type: "rename", Member: now.Member, Nick: now.Nick, From: was.Nick})
	}
	if now.Agent() && was.Recv != "" && now.Recv != was.Recv {
		what := map[string]string{channel.RecvAll: "全部", channel.RecvAt: "@我"}[now.Recv]
		s.tellMembers(c, ch, fmt.Sprintf("@%s 接收：%s", now.Nick, what), channel.Event{Type: "recv", Member: now.Member, Nick: now.Nick, Recv: now.Recv})
	}
	s.membersChanged()
	out, err := s.membersOf(c, ch)
	if err != nil {
		s.fault(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

// readsOf is how far each member has read channel ch: the people that opened it, as they said
// (readPost); its agents, as far as each was given. The channel's own agent with no row of its
// own has all of it: what is said there is its own record.
func (s *Server) readsOf(ch string) api.ChannelReads {
	out := api.ChannelReads{Channel: ch, End: s.ch.End(ch), Readers: []api.Reader{}}
	rows, err := s.st.ChannelReads(ch)
	if err != nil {
		s.logf("server: channel %s: who read it: %v", ch, err)
	}
	for _, r := range rows {
		out.Readers = append(out.Readers, api.Reader{Member: r.Reader, Name: r.Name, Seq: min(r.Seq, out.End), At: r.At})
	}
	ms, _ := s.ch.Members(ch)
	for _, m := range ms {
		if !m.Agent() {
			continue
		}
		rd := api.Reader{Member: m.Member, Nick: m.Nick, Seq: m.Seen}
		if m.Direct() {
			rd.Seq = out.End
		}
		if st, err := s.m.State(m.Session); err == nil {
			info, _ := agents.Get(st.Agent)
			rd.Agent, rd.Name = st.Agent, satori.AgentName(cmp.Or(info.Name, string(st.Agent)), *st)
		}
		out.Readers = append(out.Readers, rd)
	}
	return out
}

// seen: session's agent was given channel ch up to message seq; the pages are told.
func (s *Server) seen(ch, session string, seq int64) {
	s.ch.Seen(ch, session, seq)
	s.readsChanged(ch)
}

// readsChanged tells the pages how far channel ch is read now (the carried state "reads:<ch>").
func (s *Server) readsChanged(ch string) { s.hub.Set("reads:"+ch, s.readsOf(ch)) }

func (s *Server) readsGet(w http.ResponseWriter, r *http.Request) {
	ch, _, err := s.seeingChannel(callerOf(r), r.PathValue("id"))
	if err != nil {
		s.error(w, err)
		return
	}
	reply(w, http.StatusOK, s.readsOf(ch))
}

// readPost: the person who calls has read the channel up to a message. A login's own; an
// agent's place is what it was given.
func (s *Server) readPost(w http.ResponseWriter, r *http.Request) {
	c := callerOf(r)
	ch, _, err := s.seeingChannel(c, r.PathValue("id"))
	if err != nil {
		s.error(w, err)
		return
	}
	if c.agent || c.session != "" {
		forbid(w, errors.New("an agent has read what it was given: its place is not set by hand"))
		return
	}
	var req api.Read
	if !readJSON(w, r, &req) {
		return
	}
	seq := min(req.Seq, s.ch.End(ch))
	if seq < 1 {
		refuse(w, http.StatusBadRequest, "bad_request", "seq: the number of a message of the channel")
		return
	}
	moved, err := s.st.SetChannelRead(ch, memberOf(c), s.satoriUser(c).Name, seq)
	if err != nil {
		s.fault(w, err)
		return
	}
	if moved {
		s.readsChanged(ch)
	}
	reply(w, http.StatusOK, s.readsOf(ch))
}

// Follows: how many messages one may ask for, and for how long (seconds).
const (
	FollowCount   = 50
	FollowSeconds = 3600
)

// followAdd: the agent that calls asks to be given the next messages of a user in the channel
// (docs/channels.md "收"), named or not: Count of them (1), within Seconds (600).
func (s *Server) followAdd(w http.ResponseWriter, r *http.Request) {
	c := callerOf(r)
	ch, _, err := s.seeingChannel(c, r.PathValue("id"))
	if err != nil {
		s.error(w, err)
		return
	}
	if !s.ch.Speaks(ch, c.session) {
		forbid(w, errors.New("only an agent of the channel follows someone in it, with its ir"))
		return
	}
	var req api.Follow
	if !readJSON(w, r, &req) {
		return
	}
	user := strings.TrimPrefix(strings.TrimSpace(req.User), "@")
	if user == "" {
		refuse(w, http.StatusBadRequest, "bad_request", "user: a nick, a user's id, or * for anyone")
		return
	}
	// An agent by its nick.
	if _, by := s.agentsOf(ch); user != "*" {
		for id, m := range by {
			if strings.EqualFold(m.Nick, user) {
				user = store.AgentMember(id)
			}
		}
	}
	count, secs := cmp.Or(req.Count, 1), cmp.Or(req.Seconds, 600)
	if count < 1 || count > FollowCount || secs < 1 || secs > FollowSeconds {
		refuse(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("count: 1 to %d; seconds: 1 to %d", FollowCount, FollowSeconds))
		return
	}
	s.follows.add(ch, follow{session: c.session, user: user, left: count, until: time.Now().Add(time.Duration(secs) * time.Second)})
	reply(w, http.StatusOK, api.Follow{User: user, Count: count, Seconds: secs})
}

// memberRemove takes a member out; an agent's session stays, as any session.
func (s *Server) memberRemove(w http.ResponseWriter, r *http.Request) {
	c := callerOf(r)
	ch, _, err := s.seeingChannel(c, r.PathValue("id"))
	if err != nil {
		s.error(w, err)
		return
	}
	if err := s.inChannel(c, ch); err != nil {
		s.error(w, err)
		return
	}
	if c.agent {
		forbid(w, errors.New("an agent's ir may not change a channel's members"))
		return
	}
	member := r.PathValue("member")
	was, _ := s.memberRow(ch, member)
	if err := s.ch.Leave(ch, member); err != nil {
		s.memberFault(w, err)
		return
	}
	if was.Agent() {
		s.tellMembers(c, ch, fmt.Sprintf("@%s 离开了频道", was.Nick), channel.Event{Type: "leave", Member: member, Nick: was.Nick})
	}
	out, err := s.membersOf(c, ch)
	if err != nil {
		s.fault(w, err)
		return
	}
	refresh := []string{ch}
	if id, ok := store.SessionOfMember(member); ok {
		refresh = append(refresh, id)
	}
	s.m.Refresh(refresh)
	s.membersChanged()
	reply(w, http.StatusOK, out)
}

func (s *Server) injections(w http.ResponseWriter, r *http.Request) {
	rows, err := s.st.Injections(r.PathValue("id"), 50)
	if err != nil {
		s.fault(w, err)
		return
	}
	out := []api.Injection{}
	for _, in := range rows {
		out = append(out, api.Injection{ID: in.ID, Seq: in.Seq, Input: in.Input, At: in.At, Record: json.RawMessage(in.Record)})
	}
	reply(w, http.StatusOK, out)
}

// ---- where a message goes ----

// agentsOf are channel ch's agents as the rules see them, and each one's member row.
func (s *Server) agentsOf(ch string) ([]deliver.Agent, map[string]channel.Member) {
	ms, _ := s.ch.Members(ch)
	var out []deliver.Agent
	by := map[string]channel.Member{}
	for _, m := range ms {
		if m.Agent() {
			out = append(out, deliver.Agent{Session: m.Session, Nick: m.Nick, All: m.Recv == channel.RecvAll})
			by[m.Session] = m
		}
	}
	return out, by
}

// sendChannel says req in channel ch (several agents) as c and gives it to the agents it wakes.
// A person needs the right to use each agent the message names (Claude: the owner's own); one
// that would merely receive everything is passed over without it.
func (s *Server) sendChannel(ctx context.Context, c caller, from, ch string, req api.Send) (api.SendReply, error) {
	return s.sendChannelAs(ctx, c, from, ch, req, true)
}

// BehindMax is how many messages an agent may not have seen of a channel and still speak in it
// with ir; with more, or with one that names it, it is told to read them first.
const BehindMax = 12

// behindError refuses an agent's ir: what it has not seen of the channel, as it is told.
type behindError struct{ text string }

func (e *behindError) Error() string { return e.text }

// kin: one of sessions a and b started the other for a channel. What they say to each other
// does not count toward the agents that may pass a chain on.
func (s *Server) kin(a, b string) bool {
	if sp := s.spawnedOf(a); sp != nil && sp.By == b {
		return true
	}
	sp := s.spawnedOf(b)
	return sp != nil && sp.By == a
}

// follow: session's agent asked to be given the next left messages of user in a channel, until
// a time.
type follow struct {
	session, user string
	left          int
	until         time.Time
}

// follows are what the agents of each channel asked to be given beside what names them.
type follows struct {
	mu sync.Mutex
	of map[string][]follow
}

func (f *follows) add(ch string, x follow) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.of == nil {
		f.of = map[string][]follow{}
	}
	// One per agent and user: the new one in place of the old.
	f.of[ch] = append(slices.DeleteFunc(f.of[ch], func(o follow) bool { return o.session == x.session && o.user == x.user }), x)
}

// take are the sessions that asked for a message of author in ch (not the one that said it),
// each counted one message less.
func (f *follows) take(ch, author, sender string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now()
	var out []string
	kept := f.of[ch][:0]
	for _, x := range f.of[ch] {
		if now.After(x.until) {
			continue
		}
		if x.session != sender && (x.user == "*" || x.user == author) {
			out = append(out, x.session)
			x.left--
		}
		if x.left > 0 {
			kept = append(kept, x)
		}
	}
	if len(kept) == 0 {
		delete(f.of, ch)
	} else {
		f.of[ch] = kept
	}
	return out
}

// wakes are the agents of ch a message with words text wakes: those the rules give it to
// (deliver.Route) and those that asked for its author's (follows); sender, the agent that said
// it ("": a person), whose chain is link. After too many agents in a row only those kin to the
// sender get it; tooFar: it names someone and nobody gets it.
func (s *Server) wakes(ch, text, author, sender string, link chain, list []deliver.Agent) (wake, named []string, tooFar bool) {
	d := deliver.Route(text, sender, 0, list)
	wake = d.Wake
	for _, t := range s.follows.take(ch, author, sender) {
		if !slices.Contains(wake, t) && s.ch.Speaks(ch, t) {
			wake = append(wake, t)
		}
	}
	if sender != "" && link.hop >= deliver.MaxHops {
		wake = slices.DeleteFunc(wake, func(t string) bool { return !s.kin(sender, t) })
		tooFar = len(d.Named) > 0 && len(wake) == 0
	}
	return wake, d.Named, tooFar
}

// hopTo is how many agents passed the chain on once sender's message reaches to.
func (s *Server) hopTo(sender, to string, link chain) int {
	if sender == "" || s.kin(sender, to) {
		return link.hop
	}
	return link.hop + 1
}

// sendChannelAs is sendChannel; check: an agent that speaks is held to what it has seen of the
// channel (docs/channels.md "发送检查").
func (s *Server) sendChannelAs(ctx context.Context, c caller, from, ch string, req api.Send, check bool) (api.SendReply, error) {
	st, err := s.m.State(ch)
	if err != nil {
		return api.SendReply{}, err
	}
	if !c.Host() && !s.sees(s.permsFor(c), st.Session) {
		return api.SendReply{}, errNoSession
	}
	if err := s.inChannel(c, ch); err != nil {
		return api.SendReply{}, err
	}
	text, images, err := s.files.Message(ch, req.Text, req.Attachments)
	if err != nil {
		return api.SendReply{}, fileErr{err}
	}
	list, _ := s.agentsOf(ch)
	// An agent of the channel speaking through ir: its chain goes on, and it wakes only whom it names.
	sender, link := "", chain{origin: c.ID()}
	if s.ch.Speaks(ch, c.session) {
		sender, link = c.session, s.chain.get(c.session)
		link.origin = cmp.Or(link.origin, c.ID())
	}
	u := s.satoriUser(c)
	if tag := s.m.SourceTag(from); tag != "" {
		u.Name = tag
	}
	unseen := ""
	if sender != "" {
		u = satori.User{ID: store.AgentMember(sender)}
		// What it has not seen is given to it now, sent or not.
		_, by := s.agentsOf(ch)
		me := by[sender]
		msgs, did, _, named, err := s.unread(ch, me, 0, by)
		if err != nil {
			return api.SendReply{}, err
		}
		cc := assemble.Channel{Plan: strategy.Fold(msgs, strategy.Default), Zone: time.Local, Did: did}
		if !me.Direct() {
			cc.ID = ch
		}
		s.seen(ch, sender, s.ch.End(ch))
		if check && (named || len(msgs) > BehindMax) {
			in, err := assemble.ChannelBehind(cc, len(msgs), named)
			if err != nil {
				return api.SendReply{}, err
			}
			return api.SendReply{}, &behindError{in.String()}
		}
		if in, err := assemble.ChannelUnseen(cc); err == nil {
			unseen = in.String()
		}
	}
	routed, namedNicks, tooFar := s.wakes(ch, req.Text, u.ID, sender, link, list)
	if tooFar {
		return api.SendReply{}, fmt.Errorf("%w: more than %d agents in a row passed this on; a person goes on from here", session.ErrBadRequest, deliver.MaxHops)
	}
	var wake []string
	for _, t := range routed {
		if _, err := s.using(c, t); err != nil && sender == "" {
			if slices.ContainsFunc(list, func(a deliver.Agent) bool { return a.Session == t && slices.Contains(namedNicks, a.Nick) }) {
				return api.SendReply{}, err
			}
			continue
		}
		wake = append(wake, t)
	}
	if req.ID == "" {
		req.ID = session.NewInputID()
	}
	var of channel.Data
	if sender != "" && sender != ch {
		// Where it is from: the stretch of the agent's own record since it was called here.
		of.Session = sender
		if sst, err := s.m.State(sender); err == nil {
			of.To = sst.End
		}
		of.From = s.calls.spoke(sender, ch, of.To)
	}
	seq := s.sat.Input(st.Session, req.ID, req.Text, u, link.origin, of)
	if seq == 0 {
		return api.SendReply{}, errors.New("the channel did not take the message")
	}
	s.noteOrigin(c, ch, c.session)
	out := api.SendReply{Input: req.ID, Seq: seq, Said: true, Unseen: unseen}
	if sender != "" {
		s.seen(ch, sender, seq)
	}
	var firstErr error
	var failed []string
	sent := 0
	for _, t := range wake {
		queued, err := s.deliverTo(ctx, ch, t, seq, text, req.ID, from, req.Steer, images, chain{origin: link.origin, hop: s.hopTo(sender, t, link)})
		if err != nil {
			s.logf("server: channel %s: message %d to %s: %v", ch, seq, t, err)
			firstErr = cmp.Or(firstErr, err)
			failed = append(failed, t)
			continue
		}
		sent++
		out.Queued = out.Queued || queued
	}
	if sent == 0 && firstErr != nil {
		s.ch.Unsay(ch, seq)
		return api.SendReply{}, firstErr
	}
	// Some got it, some not: said in the channel, where everyone sees whom it did not reach.
	_, by := s.agentsOf(ch)
	for _, t := range failed {
		s.sat.Note(ch, fmt.Sprintf("未送达 #%d → @%s", seq, by[t].Nick), link.origin, &channel.Event{Type: "undelivered", Seq: seq, Nick: by[t].Nick})
	}
	return out, nil
}

// channelName is what channel ch goes by: its name, else its title.
func (s *Server) channelName(ch string) string {
	st, err := s.m.State(ch)
	if err != nil {
		return ""
	}
	return s.MaskText(cmp.Or(st.Name, st.Title))
}

// whoOf is the name a message's author goes by in the channel: an agent's nick, a person's tag.
func whoOf(m channel.Message, by map[string]channel.Member) string {
	if id, ok := store.SessionOfMember(m.Author); ok {
		return cmp.Or(by[id].Nick, "agent")
	}
	return cmp.Or(m.Name, m.Author)
}

// deliverTo gives message seq of channel ch (its words said, as the agent gets them) to the
// agent of session to: under its number, with what the channel said since the agent last read
// it. from: who it is from, as Send takes it; link: the chain the turn it begins is in.
func (s *Server) deliverTo(ctx context.Context, ch, to string, seq int64, said, input, from string, steer bool, images []agent.Image, link chain) (bool, error) {
	// One at a time for an agent: each is given what it has not seen, once.
	defer s.chain.lock(to)()
	list, by := s.agentsOf(ch)
	me, ok := by[to]
	if !ok {
		return false, channel.ErrNoMember
	}
	unseen, did, work, _, err := s.unread(ch, me, seq, by)
	if err != nil {
		return false, err
	}
	cc := assemble.Channel{You: me.Nick, Plan: strategy.Fold(unseen, strategy.Default), Pull: true, Zone: time.Local, Did: did}
	if !me.Direct() {
		// In it by a subscription: told which channel this is of, and that it speaks there with
		// ir; without one, that its reply is said there for it.
		cc.ID, cc.Name, cc.Pull = ch, s.channelName(ch), s.m.HasIR(to)
	}
	for _, a := range list {
		if a.Session == to {
			continue
		}
		// And what it has done since it last spoke.
		sum := s.ch.Doing(a.Session)
		sum.First = 0
		if w := work[a.Session]; w != nil {
			w.Sum(sum)
			sum = *w
		}
		// At another machine: its files are there.
		if st, err := s.m.State(a.Session); err == nil && st.Machine != "" {
			place := st.Machine
			if info, ok := s.gate().Endpoint(st.Machine); ok && info.Name != "" {
				place = info.Name
			}
			sum = sum.At(place)
		}
		cc.Work = append(cc.Work, assemble.Work{Who: a.Nick, Did: sum})
	}
	if st, err := s.m.State(to); err == nil && st.Machine != "" && !s.m.HasIR(to) {
		cc.Pull = false // at another machine, with no ir to read the channel with
	}
	for _, a := range list {
		ca := assemble.ChannelAgent{Nick: a.Nick}
		if st, err := s.m.State(a.Session); err == nil {
			info, _ := agents.Get(st.Agent)
			ca.Name = satori.AgentName(cmp.Or(info.Name, string(st.Agent)), *st)
		}
		cc.Agents = append(cc.Agents, ca)
	}
	in, err := assemble.ChannelTurn(cc, seq, said, input)
	if err != nil {
		return false, err
	}
	id := session.NewInputID()
	if rec, err := json.Marshal(in.Record()); err == nil {
		if err := s.st.AddInjection(store.Injection{Session: to, Channel: ch, Input: id, Seq: seq, Record: string(rec)}); err != nil {
			s.logf("server: channel %s: keeping what %s was given: %v", ch, to, err)
		}
	}
	var before int64
	if st, err := s.m.State(to); err == nil {
		before = st.End
	}
	_, queued, err := s.m.SendAs(ctx, to, id, in.String(), from, steer, images...)
	if err != nil {
		return false, err
	}
	s.seen(ch, to, seq)
	if !me.Direct() {
		s.calls.add(to, called{channel: ch, seq: seq, from: before})
	}
	// Only a person speaking begins a chain anew: what agents pass on never shortens the one
	// its receiver is in (two chains crossing would else go on past the limit).
	if cur := s.chain.get(to); link.hop > 0 && cur.hop > link.hop {
		link.hop = cur.hop
	}
	s.chain.set(to, link)
	return queued, nil
}

// unread are the messages of ch that me has not seen, below number before (0: all there are),
// others' only: as the plan of what to give takes them; did, what an agent did before saying
// one, by its number; work, by agent session, all it did over them; named: one of them names me.
func (s *Server) unread(ch string, me channel.Member, before int64, by map[string]channel.Member) (msgs []strategy.Msg, did map[int64]activity.Activity, work map[string]*activity.Activity, named bool, err error) {
	rows, err := s.ch.Between(ch, me.Seen, before, 2000)
	if err != nil {
		return nil, nil, nil, false, err
	}
	did, work = map[int64]activity.Activity{}, map[string]*activity.Activity{}
	for _, m := range rows {
		if m.Author == me.Member || (m.Kind != channel.KindUser && m.Kind != channel.KindSaid) {
			continue
		}
		id, agent := store.SessionOfMember(m.Author)
		msgs = append(msgs, strategy.Msg{Seq: m.Seq, Who: whoOf(m, by), Agent: agent, Text: m.Text, At: m.At})
		if me.Nick != "" && len(deliver.Mentions(m.Text, []string{me.Nick})) > 0 {
			named = true
		}
		if a := m.D.Activity; agent && a != nil {
			did[m.Seq] = *a
			if work[id] == nil {
				work[id] = &activity.Activity{}
			}
			work[id].Sum(*a)
		}
	}
	return msgs, did, work, named, nil
}

// routeSaid: an agent said m in its channel. In a channel of several, the agents it names are
// given it; after too many agents in a row, nobody is, and the channel says so.
func (s *Server) routeSaid(m channel.Message) {
	sender, ok := store.SessionOfMember(m.Author)
	if !ok || m.Kind != channel.KindSaid {
		return
	}
	list, by := s.agentsOf(m.Channel)
	if len(list) < 2 {
		return
	}
	link := s.chain.get(sender)
	wake, _, tooFar := s.wakes(m.Channel, m.Text, m.Author, sender, link, list)
	if tooFar {
		s.sat.Note(m.Channel, fmt.Sprintf("未转交 #%d：Agent 已连续转交 %d 次", m.Seq, deliver.MaxHops), link.origin, &channel.Event{Type: "stopped", Seq: m.Seq})
		return
	}
	if len(wake) == 0 {
		return
	}
	from := session.From(gate.HostID, "@"+by[sender].Nick)
	go func() {
		for _, t := range wake {
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			_, err := s.deliverTo(ctx, m.Channel, t, m.Seq, m.Text, "", from, true, nil, chain{origin: link.origin, hop: s.hopTo(sender, t, link)})
			cancel()
			if err != nil {
				s.logf("server: channel %s: message %d to %s: %v", m.Channel, m.Seq, t, err)
				s.sat.Note(m.Channel, fmt.Sprintf("未送达 #%d → @%s：%s", m.Seq, by[t].Nick, strings.TrimSpace(err.Error())), link.origin, &channel.Event{Type: "undelivered", Seq: m.Seq, Nick: by[t].Nick})
			}
		}
	}()
}
