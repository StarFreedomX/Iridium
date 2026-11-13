package server

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/satori"
)

// said are channel id's messages as as sees them: "<n> <who> <words>" each.
func (l *live) said(as, id string) []string {
	l.t.Helper()
	var page satori.BidiList[satori.Message]
	l.wantSat(200, as, "message.list", map[string]any{"channel_id": id, "limit": 200}, &page)
	var out []string
	for _, m := range page.Data {
		who := m.User.ID
		if m.User.Nick != "" {
			who = "@" + m.User.Nick
		}
		out = append(out, fmt.Sprintf("%s %s %s", m.ID, who, m.Content))
	}
	return out
}

// waitSaid waits until one of channel id's messages has every one of parts.
func (l *live) waitSaid(as, id string, parts ...string) []string {
	l.t.Helper()
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(30 * time.Millisecond) {
		all := l.said(as, id)
		for _, m := range all {
			ok := true
			for _, p := range parts {
				ok = ok && strings.Contains(m, p)
			}
			if ok {
				return all
			}
		}
		if time.Now().After(deadline) {
			l.t.Fatalf("no message with %q in %s:\n%s", parts, id, strings.Join(all, "\n"))
		}
	}
}

// A channel of two agents: the session's own keeps receiving what people say and speaks in it
// directly; the one added is a session of its own, given only what names it, with the words
// under their number and what it has not seen of the channel; what it says in its turn stays in
// its own channel, and it speaks in this one with ir. Agents naming each other pass the chain
// on, four times at most.
func TestChannelOfSeveral(t *testing.T) {
	t.Parallel()
	l := start(t)
	ch := l.create(200, "web", api.NewSession{Agent: api.AgentClaude, Cwd: l.work, Text: "first"})
	l.waitReply("web", ch, "ok: first")

	// One agent: the default members, nothing written.
	var ms api.ChannelMembers
	l.want(200, "web", "GET", "/v1/internal/channels/"+ch+"/members", nil, &ms)
	if ms.Multi || len(ms.Members) != 2 || ms.Members[0].Member != "*" || !ms.Joined || ms.Members[1].Session != ch || ms.Members[1].Recv != "all" || ms.Members[1].Send != "direct" {
		t.Fatalf("default members: %+v", ms)
	}

	// A second agent joins: a session of its own, a nick of its own, only what names it.
	l.want(400, "web", "POST", "/v1/internal/channels/"+ch+"/members", api.NewMember{Agent: api.AgentClaude, Nick: "a b"}, nil)
	l.want(200, "web", "POST", "/v1/internal/channels/"+ch+"/members", api.NewMember{Agent: api.AgentClaude}, &ms)
	if !ms.Multi || len(ms.Members) != 3 || ms.Members[1].Nick != "claude" || ms.Members[2].Nick != "claude2" || ms.Members[2].Recv != "at" || ms.Members[2].Send != "ir" || ms.Members[2].Name == "" {
		t.Fatalf("members: %+v", ms)
	}
	second := ms.Members[2].Session
	// The channel says who joined, and what happened with it.
	var joined satori.BidiList[satori.Message]
	l.wantSat(200, "web", "message.list", map[string]any{"channel_id": ch, "limit": 1}, &joined)
	if raw, _ := json.Marshal(joined.Data[0].Data); joined.Data[0].Content != "@claude2 加入了频道" || !strings.Contains(string(raw), `"type":"join"`) || !strings.Contains(string(raw), `"nick":"claude2"`) {
		t.Errorf("the line of the joining: %+v %s", joined.Data[0], raw)
	}
	if second == "" || second == ch {
		t.Fatalf("the second agent's session: %+v", ms.Members[2])
	}
	// It has a channel of its own, with itself alone; it is listed as any session, marked with
	// the channel it is in and where it was started.
	var own api.ChannelMembers
	if l.want(200, "web", "GET", "/v1/internal/channels/"+second+"/members", nil, &own); own.Channel != second || own.Multi || len(own.Members) != 2 {
		t.Errorf("the second agent's own channel: %+v", own)
	}
	found := false
	for _, ss := range l.sessions("web") {
		switch ss.ID {
		case second:
			found = true
			if len(ss.In) != 1 || ss.In[0] != ch || ss.Spawned == nil || ss.Spawned.Channel != ch || ss.Launcher != "" {
				t.Errorf("the second agent as listed: %+v", ss)
			}
		case ch:
			if len(ss.Agents) != 2 || ss.Agents[0].Session != ch || ss.Agents[1].Nick != "claude2" || len(ss.In) != 0 {
				t.Errorf("the channel as listed: %+v", ss)
			}
		}
	}
	if !found {
		t.Errorf("the second agent is not listed")
	}
	// In it already: not twice, nor the channel's own agent.
	l.want(409, "web", "POST", "/v1/internal/channels/"+ch+"/members", api.NewMember{Session: second}, nil)
	l.want(409, "web", "POST", "/v1/internal/channels/"+ch+"/members", api.NewMember{Session: ch}, nil)

	// What a new agent of the kind may start with here: as the latest session of it said.
	var choices api.AgentChoices
	l.want(200, "web", "GET", "/v1/internal/agents/claude/choices?channel="+ch, nil, &choices)
	var first api.SessionState
	l.do("web", "GET", "/v1/internal/sessions/"+ch, nil, &first)
	if len(choices.Models) != len(first.Models) || choices.Models == nil || choices.Efforts == nil {
		t.Errorf("choices: %+v, the session's %+v", choices, first.Models)
	}
	l.want(200, "web", "GET", "/v1/internal/agents/pi/choices", nil, &choices)
	if len(choices.Models) != 0 {
		t.Errorf("choices of a kind that never ran: %+v", choices)
	}

	// Nobody named: the channel's own agent alone answers; the second is given nothing.
	code, r := l.send("web", ch, api.Send{Text: "plain words"})
	if code != 200 || r.Seq == 0 {
		t.Fatalf("send: %d %+v", code, r)
	}
	l.waitSaid("web", ch, "@claude ", fmt.Sprintf("ok: #%d: plain words", r.Seq))
	if p := l.page("web", second); len(p.Blocks) != 0 {
		t.Errorf("the second agent was given: %+v", p.Blocks)
	}

	// Named: it gets the words under their number and what it has not seen, each message once,
	// and is told which channel this is and how it speaks there. What it says in its turn is
	// said in its own channel, not in this one.
	code, r = l.send("web", ch, api.Send{Text: "now @claude2 look"})
	if code != 200 {
		t.Fatalf("send naming: %d %+v", code, r)
	}
	l.waitSaid("web", second, "@claude2 ", fmt.Sprintf("ok: #%d: now @claude2 look", r.Seq))
	p := l.page("web", second)
	if len(p.Blocks) == 0 || p.Blocks[0].Kind != api.BlockKindUser {
		t.Fatalf("the second agent's record: %+v", p.Blocks)
	}
	got := p.Blocks[0].Text
	for _, want := range []string{fmt.Sprintf("#%d: now @claude2 look", r.Seq), "<channel-context>", "You are claude2, called in the channel", "message.create channel_id=" + ch,
		"message.list channel_id=" + ch, "claude (", "]: first\n", "]: ok: first\n", "]: plain words\n", "</channel-context>"} {
		if !strings.Contains(got, want) {
			t.Errorf("given without %q:\n%s", want, got)
		}
	}
	if strings.Count(got, "plain words") != 2 { // the words, and the first agent's echo of them
		t.Errorf("given twice:\n%s", got)
	}
	for _, m := range l.said("web", ch) {
		if strings.Contains(m, " @claude2 ok:") {
			t.Errorf("the second agent's turn was said in the channel: %s", m)
		}
	}
	// What it was given is not a message of its own channel: only what it said is.
	for _, m := range l.said("web", second) {
		if !strings.Contains(m, " @claude2 ") {
			t.Errorf("in the second agent's own channel: %s", m)
		}
	}

	// What it was given is kept: where each part came from.
	var ins []api.Injection
	l.want(200, "web", "GET", "/v1/internal/sessions/"+second+"/injections", nil, &ins)
	if n := len(ins); n == 0 || ins[0].Seq != r.Seq || !strings.Contains(string(ins[0].Record), `"prompts:channel.context.guest"`) || strings.Contains(string(ins[0].Record), "plain words") {
		t.Errorf("injections: %+v", ins)
	}

	// It speaks in the channel with ir: said there under its nick, given to whom it names.
	var sent []satori.Message
	l.wantSat(200, "agent-in:"+second, "message.create", map[string]any{"channel_id": ch, "content": "seen, @claude go on"}, &sent)
	all := l.waitSaid("web", ch, "@claude ", "seen, @claude go on", "ok: #")
	if !slices.ContainsFunc(all, func(m string) bool { return strings.Contains(m, " @claude2 seen, @claude go on") }) {
		t.Errorf("what it sent is not said under its nick:\n%s", strings.Join(all, "\n"))
	}

	// The fake agents echo what they get. The second keeps sending the first words that name
	// both: the first's echo calls the second back, and so on, until four agents in a row have
	// passed the chain on: then its ir is refused.
	stopped := false
	for i := range 8 {
		words := fmt.Sprintf("@claude tell @claude2 round%d", i)
		if code := l.sat("agent-in:"+second, "message.create", map[string]any{"channel_id": ch, "content": words}, nil); code == 400 {
			stopped = true
			break
		} else if code != 200 {
			t.Fatalf("round %d: %d", i, code)
		}
		l.waitSaid("web", second, fmt.Sprintf("round%d", i))
	}
	if !stopped {
		t.Errorf("the agents went on passing it")
	}
	// A person speaking begins anew.
	if code, _ := l.send("web", ch, api.Send{Text: "@claude2 again"}); code != 200 {
		t.Fatalf("a person after the chain stopped: %d", code)
	}
	l.waitSaid("web", second, "@claude2 again")
	if code := l.sat("agent-in:"+second, "message.create", map[string]any{"channel_id": ch, "content": "fine"}, nil); code != 200 {
		t.Errorf("the second agent after a person spoke: %d", code)
	}

	// An agent reads its own record and its channel.
	if code := l.sat("agent-in:"+ch, "internal/block.list", map[string]any{"channel_id": ch}, nil); code != 200 {
		t.Errorf("an agent reading its own record: %d", code)
	}
	if code := l.sat("agent-in:"+ch, "message.list", map[string]any{"channel_id": "self"}, nil); code != 200 {
		t.Errorf("an agent reading its channel: %d", code)
	}
	if code := l.sat("agent-in:"+second, "message.list", map[string]any{"channel_id": ch}, nil); code != 200 {
		t.Errorf("an agent reading a channel it is in: %d", code)
	}
	// An agent leaves: the channel one agent's again; its session stays as it is.
	l.want(200, "web", "DELETE", "/v1/internal/channels/"+ch+"/members/agent:"+second, nil, &ms)
	if ms.Multi || len(ms.Members) != 2 {
		t.Fatalf("after it left: %+v", ms)
	}
	var st api.SessionState
	if l.want(200, "web", "GET", "/v1/internal/sessions/"+second, nil, &st); st.Archived {
		t.Errorf("the session of the agent that left: %+v", st.Session)
	}
	l.want(422, "web", "DELETE", "/v1/internal/channels/"+ch+"/members/agent:"+ch, nil, nil)
	code, r = l.send("web", ch, api.Send{Text: "alone again"})
	if code != 200 {
		t.Fatalf("send alone: %d", code)
	}
	l.waitSaid("web", ch, "ok: alone again")

	// A session there is joins as it is, under the nick it had; it keeps its own channel.
	l.want(200, "web", "POST", "/v1/internal/channels/"+ch+"/members", api.NewMember{Session: second, Recv: "all"}, &ms)
	if !ms.Multi || len(ms.Members) != 3 || ms.Members[2].Session != second || ms.Members[2].Nick != "claude2" || ms.Members[2].Recv != "all" {
		t.Fatalf("a session there is, joined: %+v", ms)
	}
	// Receiving everything: what a person says with no name wakes it too.
	code, r = l.send("web", ch, api.Send{Text: "to all of you"})
	if code != 200 {
		t.Fatalf("send to all: %d", code)
	}
	l.waitSaid("web", ch, "@claude ", fmt.Sprintf("ok: #%d: to all of you", r.Seq))
	l.waitSaid("web", second, fmt.Sprintf("ok: #%d: to all of you", r.Seq))
}

// A channel's people: everyone unless chosen. One who is not among them still reads it, and
// neither speaks in it nor changes it; anyone among them changes who is.
func TestChannelPeople(t *testing.T) {
	t.Parallel()
	l := start(t)
	ch := l.create(200, "web", api.NewSession{Agent: api.AgentClaude, Cwd: l.work, Text: "first"})
	l.waitReply("web", ch, "ok: first")
	bot := l.newApp("bot", true).Token
	if code, _ := l.send(bot, ch, api.Send{Text: "from the bot"}); code != 200 {
		t.Fatalf("everyone speaks: %d", code)
	}
	l.waitSaid("web", ch, "ok: from the bot")

	// The page chooses the people: itself. The bot reads, and that is all.
	var ms api.ChannelMembers
	l.want(200, "web", "GET", "/v1/internal/channels/"+ch+"/members", nil, &ms)
	me := ms.Me
	if me == "" || !ms.Joined {
		t.Fatalf("me: %+v", ms)
	}
	l.want(400, "web", "PUT", "/v1/internal/channels/"+ch+"/people", api.People{People: []string{"nonsense"}}, nil)
	l.want(200, "web", "PUT", "/v1/internal/channels/"+ch+"/people", api.People{People: []string{me}}, &ms)
	if !ms.Joined || len(ms.Members) != 2 || ms.Members[1].Member != me && ms.Members[0].Member != me {
		t.Fatalf("people chosen: %+v", ms)
	}
	if code, _ := l.send(bot, ch, api.Send{Text: "again"}); code != 403 {
		t.Errorf("one not among them speaks: %d", code)
	}
	if code := l.sat(bot, "message.list", map[string]any{"channel_id": ch}, nil); code != 200 {
		t.Errorf("one not among them reads: %d", code)
	}
	var theirs api.ChannelMembers
	if l.asLogin(bot, "main", "GET", "/v1/internal/channels/"+ch+"/members", nil, &theirs); theirs.Joined {
		t.Errorf("joined: %+v", theirs)
	}
	if code := l.asLogin(bot, "main", "PUT", "/v1/internal/channels/"+ch+"/people", api.People{}, nil); code != 403 {
		t.Errorf("one not among them changes them: %d", code)
	}
	if code := l.asLogin(bot, "main", "POST", "/v1/internal/sessions/"+ch+"/interrupt", nil, nil); code != 403 {
		t.Errorf("one not among them stops the agent: %d", code)
	}
	if code, _ := l.send("web", ch, api.Send{Text: "mine"}); code != 200 {
		t.Errorf("one of them speaks: %d", code)
	}
	l.waitSaid("web", ch, "ok: mine")
	// The host is always one. None chosen: everyone again.
	if code, _ := l.send("socket", ch, api.Send{Text: "host"}); code != 200 {
		t.Errorf("the host speaks: %d", code)
	}
	l.want(200, "web", "PUT", "/v1/internal/channels/"+ch+"/people", api.People{}, &ms)
	if code, _ := l.send(bot, ch, api.Send{Text: "back"}); code != 200 {
		t.Errorf("everyone again: %d", code)
	}
}

// A session made with its channel's members: the agents there from the start, each a session
// of its own, its first words said in the channel, reaching whom they name.
func TestChannelCreatedWhole(t *testing.T) {
	t.Parallel()
	l := start(t)
	ch := l.create(200, "web", api.NewSession{Agent: api.AgentClaude, Cwd: l.work, Text: "@helper begin",
		Members: &api.ChannelSetup{Nick: "lead", Agents: []api.NewMember{{Agent: api.AgentClaude, Nick: "helper"}, {Agent: api.AgentClaude}}}})
	var ms api.ChannelMembers
	l.want(200, "web", "GET", "/v1/internal/channels/"+ch+"/members", nil, &ms)
	if !ms.Multi || len(ms.Members) != 4 || ms.Members[1].Nick != "lead" || ms.Members[2].Nick != "helper" || ms.Members[3].Nick != "claude" {
		t.Fatalf("members: %+v", ms)
	}
	// The one named answers, in its own channel; the others were given nothing.
	l.waitSaid("web", ms.Members[2].Session, "@helper ", "ok: #1: @helper begin")
	for _, m := range l.said("web", ch) {
		if strings.Contains(m, "@lead ") || strings.Contains(m, "@claude ") || strings.Contains(m, "@helper ok") {
			t.Errorf("another answered: %s", m)
		}
	}
	if p := l.page("web", ms.Members[3].Session); len(p.Blocks) != 0 {
		t.Errorf("one not named was given: %+v", p.Blocks)
	}
	l.create(400, "web", api.NewSession{Agent: api.AgentClaude, Cwd: l.work, Members: &api.ChannelSetup{Agents: []api.NewMember{{Agent: api.AgentClaude, Nick: "a b"}}}})
}
