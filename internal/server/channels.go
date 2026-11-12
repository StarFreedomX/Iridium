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
// goes. With one agent a channel is the session it always was (sendAs). With more, a message is
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

func (s *Server) channelRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/internal/channels/{id}/members", s.membersGet)
	mux.HandleFunc("POST /v1/internal/channels/{id}/members", s.memberAdd)
	mux.HandleFunc("PATCH /v1/internal/channels/{id}/members/{member}", s.memberPatch)
	mux.HandleFunc("DELETE /v1/internal/channels/{id}/members/{member}", s.memberRemove)
	mux.HandleFunc("PUT /v1/internal/channels/{id}/people", s.peoplePut)
	mux.HandleFunc("GET /v1/internal/sessions/{id}/injections", s.use(s.injections))
}

// channelOf is the channel session id is an agent of and, where it has several, its agents:
// what the list of sessions is marked with.
func (s *Server) channelOf(id string) (string, []api.ChannelAgent) {
	ch := s.ch.Of(id)
	if ch != id {
		return ch, nil
	}
	ms, _ := s.ch.Members(ch)
	var out []api.ChannelAgent
	for _, m := range ms {
		if m.Agent() {
			out = append(out, api.ChannelAgent{Session: m.Session, Nick: m.Nick})
		}
	}
	if len(out) < 2 {
		return ch, nil
	}
	return ch, out
}

// membersChanged tells the pages a channel's members changed: the list of sessions again, and
// the state "channels" (a number that only goes up; a page reads the members again).
func (s *Server) membersChanged() {
	s.hub.Set("channels", s.channelsSeq.Add(1))
	s.m.PublishList()
}

// errNotMember: the caller sees the channel but is not one of its people.
var errNotMember = &access.Denied{Reason: "not one of this channel's people: it can be read, not spoken in"}

// inChannel checks that c is one of the people of the channel session id is in (docs/channels.md
// "人"): the host always; an agent of the channel; else the caller's login, as the channel's
// people name it. Whoever is not may still read.
func (s *Server) inChannel(c caller, id string) error {
	ch := s.ch.Of(id)
	if c.Host() && !c.agent && c.session == "" {
		return nil
	}
	if sid := cmp.Or(c.session, c.Session); sid != "" && s.ch.Of(sid) == ch {
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

// multi: channel ch has more than one agent.
func (s *Server) multi(ch string) bool { return len(s.ch.Agents(ch)) > 1 }

// inMulti: session id is an agent of a channel with others in it.
func (s *Server) inMulti(id string) bool { return s.multi(s.ch.Of(id)) }

// seeingChannel is the channel {id} names (a channel, or a member session of one) if c sees it.
func (s *Server) seeingChannel(c caller, id string) (string, *api.SessionState, error) {
	ch := s.ch.Of(id)
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
		am := api.ChannelMember{Member: m.Member, Session: m.Session, Nick: m.Nick, Recv: m.Recv, Seen: m.Seen}
		if m.Agent() {
			n++
			if st, err := s.m.State(m.Session); err == nil {
				info, _ := agents.Get(st.Agent)
				am.Agent, am.Status = st.Agent, st.Status
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

// memberAdd starts a new agent in the channel's folder and puts it in the channel. Whoever may
// start that agent there may add it: a person, or an agent of the channel (ir).
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
	if len(s.ch.Agents(ch)) >= MaxAgents {
		refuse(w, http.StatusConflict, "full", fmt.Sprintf("a channel has at most %d agents", MaxAgents))
		return
	}
	if req.Nick != "" && !deliver.ValidNick(req.Nick) {
		s.memberFault(w, channel.ErrNick)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	if _, err := s.addAgent(ctx, c, ch, st, req); err != nil {
		s.memberFault(w, err)
		return
	}
	out, err := s.membersOf(c, ch)
	if err != nil {
		s.fault(w, err)
		return
	}
	s.membersChanged()
	reply(w, http.StatusOK, out)
}

// addAgent starts a new agent in channel ch's folder (st: the channel's session) as c and puts
// it in the channel: the session it is.
func (s *Server) addAgent(ctx context.Context, c caller, ch string, st *api.SessionState, req api.NewMember) (string, error) {
	if len(s.ch.Agents(ch)) >= MaxAgents {
		return "", errFull
	}
	if req.Nick != "" && !deliver.ValidNick(req.Nick) {
		return "", channel.ErrNick
	}
	id, err := s.createAs(ctx, c, api.NewSession{Agent: req.Agent, Cwd: st.Cwd, Machine: st.Machine, Model: req.Model, Mode: req.Mode,
		Effort: req.Effort, Preset: req.Preset, Caller: ch})
	if err != nil {
		return "", err
	}
	m, err := s.ch.Join(ch, id, req.Nick, req.Recv, s.harnessOf)
	if err != nil {
		_ = s.m.ArchiveTree(ctx, id, true)
		return "", err
	}
	// Started before it was a member: again at its first message, told what it is (assemble's
	// channel.system).
	if err := s.m.Stop(ctx, id); err == nil {
		// Till it is gone: a message sent meanwhile would find a process on its way out.
		for end := time.Now().Add(10 * time.Second); time.Now().Before(end); time.Sleep(50 * time.Millisecond) {
			if st, err := s.m.State(id); err != nil || !st.Live {
				break
			}
		}
	}
	s.logf("server: channel %s: %s joined as @%s (%s)", ch, id, m.Nick, m.Recv)
	s.m.Refresh([]string{ch, id})
	return id, nil
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
	if err := s.setPeople(c, ch, req.People); err != nil {
		s.memberFault(w, err)
		return
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
	if c.agent {
		forbid(w, errors.New("an agent's ir may not change a channel's members"))
		return
	}
	var p api.MemberPatch
	if !readJSON(w, r, &p) {
		return
	}
	if _, err := s.ch.Change(ch, r.PathValue("member"), p.Nick, p.Recv, s.harnessOf); err != nil {
		s.memberFault(w, err)
		return
	}
	s.membersChanged()
	out, err := s.membersOf(c, ch)
	if err != nil {
		s.fault(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

// memberRemove takes a member out; an agent's session is archived with it.
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
	if err := s.ch.Leave(ch, member); err != nil {
		s.memberFault(w, err)
		return
	}
	if id, ok := store.SessionOfMember(member); ok {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		if err := s.m.ArchiveTree(ctx, id, true); err != nil {
			s.logf("server: channel %s: archiving %s: %v", ch, id, err)
		}
	}
	out, err := s.membersOf(c, ch)
	if err != nil {
		s.fault(w, err)
		return
	}
	s.m.Refresh([]string{ch})
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
// to: the session the sender addressed, ch itself or one member (then that agent alone, as if
// named). A person needs the right to use each agent the message names (Claude: the owner's
// own); one that would merely receive everything is passed over without it.
func (s *Server) sendChannel(ctx context.Context, c caller, from, ch, to string, req api.Send) (api.SendReply, error) {
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
	text, images, err := s.files.Message(to, req.Text, req.Attachments)
	if err != nil {
		return api.SendReply{}, fileErr{err}
	}
	list, _ := s.agentsOf(ch)
	// An agent of the channel speaking through ir: its chain goes on, and it wakes only whom it names.
	sender, link := "", chain{origin: c.ID()}
	if c.session != "" && s.ch.Of(c.session) == ch {
		sender, link = c.session, s.chain.get(c.session)
		link.origin = cmp.Or(link.origin, c.ID())
	}
	if sender != "" && to == sender {
		to = ch // an agent's "self" is its channel: it does not send to itself
	}
	var d deliver.Decision
	if to != ch {
		d.Wake = []string{to}
	} else {
		d = deliver.Route(req.Text, sender, link.hop, list)
	}
	if d.TooFar {
		return api.SendReply{}, fmt.Errorf("%w: more than %d agents in a row passed this on; a person goes on from here", session.ErrBadRequest, deliver.MaxHops)
	}
	var wake []string
	for _, t := range d.Wake {
		if _, err := s.using(c, t); err != nil && sender == "" {
			named := to != ch || slices.ContainsFunc(list, func(a deliver.Agent) bool { return a.Session == t && slices.Contains(d.Named, a.Nick) })
			if named {
				return api.SendReply{}, err
			}
			continue
		}
		wake = append(wake, t)
	}
	if req.ID == "" {
		req.ID = session.NewInputID()
	}
	u := s.satoriUser(c)
	if tag := s.m.SourceTag(from); tag != "" {
		u.Name = tag
	}
	if sender != "" {
		u = satori.User{ID: store.AgentMember(sender)}
	}
	seq := s.sat.Input(st.Session, req.ID, req.Text, u, link.origin)
	if seq == 0 {
		return api.SendReply{}, errors.New("the channel did not take the message")
	}
	s.noteOrigin(c, ch, c.session)
	out := api.SendReply{Input: req.ID, Seq: seq}
	hop := link.hop
	if sender != "" {
		hop++
	}
	var firstErr error
	var failed []string
	sent := 0
	for _, t := range wake {
		queued, err := s.deliverTo(ctx, ch, t, seq, text, req.ID, from, req.Steer, images, chain{origin: link.origin, hop: hop})
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
		s.sat.Note(ch, fmt.Sprintf("未送达 #%d → @%s", seq, by[t].Nick), link.origin)
	}
	return out, nil
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
	rows, err := s.ch.Between(ch, me.Seen, seq, 2000)
	if err != nil {
		return false, err
	}
	var unseen []strategy.Msg
	did := map[int64]activity.Activity{}
	work := map[string]*activity.Activity{} // by agent session: all it did over what was not seen
	for _, m := range rows {
		if m.Author == me.Member || (m.Kind != channel.KindUser && m.Kind != channel.KindSaid) {
			continue
		}
		id, agent := store.SessionOfMember(m.Author)
		unseen = append(unseen, strategy.Msg{Seq: m.Seq, Who: whoOf(m, by), Agent: agent, Text: m.Text, At: m.At})
		if a := m.D.Activity; agent && a != nil {
			did[m.Seq] = *a
			if work[id] == nil {
				work[id] = &activity.Activity{}
			}
			work[id].Sum(*a)
		}
	}
	cc := assemble.Channel{You: me.Nick, Plan: strategy.Fold(unseen, strategy.Default), Pull: true, Zone: time.Local, Did: did}
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
		cc.Work = append(cc.Work, assemble.Work{Who: a.Nick, Did: sum})
	}
	if st, err := s.m.State(to); err == nil && st.Machine != "" {
		cc.Pull = false // at another machine: no ir of the host's to read the channel with
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
	_, queued, err := s.m.SendAs(ctx, to, id, in.String(), from, steer, images...)
	if err != nil {
		return false, err
	}
	s.ch.Seen(ch, to, seq)
	s.chain.set(to, link)
	return queued, nil
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
	d := deliver.Route(m.Text, sender, link.hop, list)
	if d.TooFar {
		s.sat.Note(m.Channel, fmt.Sprintf("未转交 #%d：Agent 已连续转交 %d 次", m.Seq, deliver.MaxHops), link.origin)
		return
	}
	if len(d.Wake) == 0 {
		return
	}
	from := session.From(gate.HostID, "@"+by[sender].Nick)
	go func() {
		for _, t := range d.Wake {
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			_, err := s.deliverTo(ctx, m.Channel, t, m.Seq, m.Text, "", from, true, nil, chain{origin: link.origin, hop: link.hop + 1})
			cancel()
			if err != nil {
				s.logf("server: channel %s: message %d to %s: %v", m.Channel, m.Seq, t, err)
				s.sat.Note(m.Channel, fmt.Sprintf("未送达 #%d → @%s：%s", m.Seq, by[t].Nick, strings.TrimSpace(err.Error())), link.origin)
			}
		}
	}()
}
