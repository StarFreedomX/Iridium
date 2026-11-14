package server

import (
	"testing"

	"github.com/kumoSleeping/iridium/internal/api"
)

// An agent woken in a channel acts for whoever woke it: its ir has that login's rights, not
// those of whoever its last turn was for; the channel's own agent, not woken, is as it was.
func TestChannelWakeOrigin(t *testing.T) {
	t.Parallel()
	l := start(t)
	ch := l.create(200, "web", api.NewSession{Agent: api.AgentClaude, Cwd: l.work, Text: "first"})
	l.waitReply("web", ch, "ok: first")
	var ms api.ChannelMembers
	l.want(200, "web", "POST", "/v1/internal/channels/"+ch+"/members", api.NewMember{Agent: api.AgentClaude}, &ms)
	second := ms.Members[len(ms.Members)-1].Session
	if o, ok := l.s.originOf(second); !ok || !o.Host() {
		t.Fatalf("the second agent's turn before anyone woke it: %+v %v", o, ok)
	}
	bot := l.newApp("bot", true).Token
	l.want(200, "web", "PUT", "/v1/internal/channels/"+ch+"/people", api.People{People: []string{"*"}}, nil)
	code, r := l.send(bot, ch, api.Send{Text: "@claude2 from the bot"})
	if code != 200 {
		t.Fatalf("the bot names the second agent: %d %+v", code, r)
	}
	l.waitSaid("web", second, "from the bot")
	if o, ok := l.s.originOf(second); !ok || o.Host() || o.App == "" {
		t.Errorf("the woken agent's turn is for %+v, not the bot", o)
	}
	if o, ok := l.s.originOf(ch); !ok || !o.Host() {
		t.Errorf("the channel's own agent, not woken, is now for %+v", o)
	}
}
