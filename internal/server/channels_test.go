package server

import (
	"encoding/json"
	"fmt"
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

// A channel of two agents: the first keeps receiving what people say, the one added only what
// names it; each is given the words under their number and what it has not seen of the channel,
// never the other's record; an agent naming another passes the chain on, four times at most.
func TestChannelOfSeveral(t *testing.T) {
	t.Parallel()
	l := start(t)
	ch := l.create(200, "web", api.NewSession{Agent: api.AgentClaude, Cwd: l.work, Text: "first"})
	l.waitReply("web", ch, "ok: first")

	// One agent: the default members, nothing written.
	var ms api.ChannelMembers
	l.want(200, "web", "GET", "/v1/internal/channels/"+ch+"/members", nil, &ms)
	if ms.Multi || len(ms.Members) != 2 || ms.Members[0].Member != "*" || !ms.Joined || ms.Members[1].Session != ch || ms.Members[1].Recv != "all" {
		t.Fatalf("default members: %+v", ms)
	}

	// A second agent joins: a nick of its own, only what names it.
	l.want(400, "web", "POST", "/v1/internal/channels/"+ch+"/members", api.NewMember{Agent: api.AgentClaude, Nick: "a b"}, nil)
	l.want(200, "web", "POST", "/v1/internal/channels/"+ch+"/members", api.NewMember{Agent: api.AgentClaude}, &ms)
	if !ms.Multi || len(ms.Members) != 3 || ms.Members[1].Nick != "claude" || ms.Members[2].Nick != "claude2" || ms.Members[2].Recv != "at" || ms.Members[2].Name == "" {
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
	// The same from either's id.
	var again api.ChannelMembers
	if l.want(200, "web", "GET", "/v1/internal/channels/"+second+"/members", nil, &again); again.Channel != ch {
		t.Errorf("members by a member's id: %+v", again)
	}

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

	// Nobody named: the first agent alone answers; the second is given nothing.
	code, r := l.send("web", ch, api.Send{Text: "plain words"})
	if code != 200 || r.Seq == 0 {
		t.Fatalf("send: %d %+v", code, r)
	}
	l.waitSaid("web", ch, "@claude ", fmt.Sprintf("ok: #%d: plain words", r.Seq))
	if p := l.page("web", second); len(p.Blocks) != 0 {
		t.Errorf("the second agent was given: %+v", p.Blocks)
	}

	// Named: it gets the words under their number and what it has not seen, each message once.
	code, r = l.send("web", ch, api.Send{Text: "now @claude2 look"})
	if code != 200 {
		t.Fatalf("send naming: %d %+v", code, r)
	}
	l.waitSaid("web", ch, "@claude2 ", fmt.Sprintf("ok: #%d: now @claude2 look", r.Seq))
	p := l.page("web", second)
	if len(p.Blocks) == 0 || p.Blocks[0].Kind != api.BlockKindUser {
		t.Fatalf("the second agent's record: %+v", p.Blocks)
	}
	got := p.Blocks[0].Text
	for _, want := range []string{fmt.Sprintf("#%d: now @claude2 look", r.Seq), "<channel-context>", "You are claude2", "claude (", "]: first\n", "]: ok: first\n", "]: plain words\n", "</channel-context>"} {
		if !strings.Contains(got, want) {
			t.Errorf("given without %q:\n%s", want, got)
		}
	}
	if strings.Count(got, "plain words") != 2 { // the words, and the first agent's echo of them
		t.Errorf("given twice:\n%s", got)
	}

	// What it was given is kept: where each part came from.
	var ins []api.Injection
	l.want(200, "web", "GET", "/v1/internal/sessions/"+second+"/injections", nil, &ins)
	if n := len(ins); n == 0 || ins[n-1].Seq != r.Seq || !strings.Contains(string(ins[n-1].Record), `"prompts:channel.context.members"`) || strings.Contains(string(ins[n-1].Record), "plain words") {
		t.Errorf("injections: %+v", ins)
	}

	// The fake agents echo what they get: with both named, each echo calls the other, until four
	// agents in a row have passed it on; then the channel says it stops, and it does.
	if code, _ := l.send("web", ch, api.Send{Text: "@claude and @claude2: ping"}); code != 200 {
		t.Fatalf("send to both: %d", code)
	}
	l.waitSaid("web", ch, "iridium", "未转交")
	// It stops: soon nothing more is said, well within what four passes of two agents make.
	n, still := 0, time.Now()
	for end := time.Now().Add(15 * time.Second); time.Since(still) < 700*time.Millisecond; time.Sleep(50 * time.Millisecond) {
		if now := len(l.said("web", ch)); now != n {
			n, still = now, time.Now()
		}
		if time.Now().After(end) {
			t.Fatalf("it goes on: %d messages", n)
		}
	}
	if n > 60 {
		t.Errorf("%d messages before it stopped", n)
	}

	// A member's record is its own: the other agent's ir does not read it; a person does.
	if code := l.sat("agent-in:"+ch, "internal/block.list", map[string]any{"channel_id": second}, nil); code != 403 {
		t.Errorf("an agent reading the other's record: %d", code)
	}
	if code := l.sat("agent-in:"+ch, "internal/block.list", map[string]any{"channel_id": ch}, nil); code != 200 {
		t.Errorf("an agent reading its own record: %d", code)
	}
	if code := l.sat("agent-in:"+ch, "message.list", map[string]any{"channel_id": "self"}, nil); code != 200 {
		t.Errorf("an agent reading its channel: %d", code)
	}
	// An agent leaves: its session archived, the channel one agent's again.
	l.want(200, "web", "DELETE", "/v1/internal/channels/"+ch+"/members/agent:"+second, nil, &ms)
	if ms.Multi || len(ms.Members) != 2 {
		t.Fatalf("after it left: %+v", ms)
	}
	l.want(422, "web", "DELETE", "/v1/internal/channels/"+ch+"/members/agent:"+ch, nil, nil)
	code, r = l.send("web", ch, api.Send{Text: "alone again"})
	if code != 200 {
		t.Fatalf("send alone: %d", code)
	}
	l.waitSaid("web", ch, "ok: alone again")
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

// A session made with its channel's members: the agents there from the start, its first words
// said in the channel, reaching whom they name.
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
	all := l.waitSaid("web", ch, "@helper ", "ok: #1: @helper begin")
	for _, m := range all {
		if strings.Contains(m, "@lead ") || strings.Contains(m, "@claude ") {
			t.Errorf("another answered: %s", m)
		}
	}
	l.create(400, "web", api.NewSession{Agent: api.AgentClaude, Cwd: l.work, Members: &api.ChannelSetup{Agents: []api.NewMember{{Agent: api.AgentClaude, Nick: "a b"}}}})
}
