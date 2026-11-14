package server

import (
	"fmt"
	"strings"
	"testing"
	"time"

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

// two is a channel of two agents: its own, and a second one in it by a subscription.
func two(t *testing.T) (l *live, ch, second string) {
	t.Helper()
	l = start(t)
	ch = l.create(200, "web", api.NewSession{Agent: api.AgentClaude, Cwd: l.work, Text: "first"})
	l.waitReply("web", ch, "ok: first")
	var ms api.ChannelMembers
	l.want(200, "web", "POST", "/v1/internal/channels/"+ch+"/members", api.NewMember{Agent: api.AgentClaude}, &ms)
	return l, ch, ms.Members[len(ms.Members)-1].Session
}

// running waits until session id's agent is in a turn.
func (l *live) running(id string) {
	l.t.Helper()
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(10 * time.Millisecond) {
		var st api.SessionState
		if l.do("web", "GET", "/v1/internal/sessions/"+id, nil, &st); st.Status == api.StatusRunning {
			return
		}
		if time.Now().After(deadline) {
			l.t.Fatalf("no turn in %s", id)
		}
	}
}

// noCalls waits until session id's agent has no call open.
func (l *live) noCalls(id string) {
	l.t.Helper()
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(20 * time.Millisecond) {
		l.s.calls.mu.Lock()
		n := len(l.s.calls.load(id))
		l.s.calls.mu.Unlock()
		if n == 0 {
			return
		}
		if time.Now().After(deadline) {
			l.t.Fatalf("%s has %d calls open still", id, n)
		}
	}
}

// A call waits for the turn that takes its message: a turn of the agent's own that ends while
// the message waits in the queue is not its answer, and is not said in the channel.
func TestChannelCallWaitsForItsTurn(t *testing.T) {
	t.Parallel()
	l, ch, second := two(t)
	if code, _ := l.send("web", second, api.Send{Text: "its own work WAIT"}); code != 200 {
		t.Fatalf("send to the second: %d", code)
	}
	l.running(second)
	code, r := l.send("web", ch, api.Send{Text: "@claude2 when you can"})
	if code != 200 || !r.Queued {
		t.Fatalf("a message for a busy agent: %d %+v", code, r)
	}
	all := l.waitSaid("web", ch, " @claude2 ", fmt.Sprintf("ok: #%d: @claude2 when you can", r.Seq))
	for _, m := range all {
		if strings.Contains(m, "its own work") {
			t.Errorf("another turn's reply said in the channel: %s", m)
		}
	}
	l.noCalls(second)
}

// A turn cut short (the agent stopped) closes its calls: the channel is told the agent said
// nothing, and what it says in a later turn of its own is not said there.
func TestChannelCallClosedWhenCutShort(t *testing.T) {
	t.Parallel()
	l, ch, second := two(t)
	if code, _ := l.send("web", second, api.Send{Text: "its own work HOLD"}); code != 200 {
		t.Fatalf("send to the second: %d", code)
	}
	l.running(second)
	// Open while the turn runs, as a message that joined it leaves it.
	l.s.calls.add(second, called{Channel: ch, Seq: 1, Input: "0190a7c0-0000-7000-8000-000000000001"})
	l.want(200, "web", "POST", "/v1/internal/sessions/"+second+"/stop", nil, nil)
	l.waitSaid("web", ch, "@claude2 被叫起（#1）")
	l.noCalls(second)
	if code, _ := l.send("web", second, api.Send{Text: "unrelated"}); code != 200 {
		t.Fatalf("send to the second after the stop: %d", code)
	}
	l.waitReply("web", second, "ok: unrelated")
	time.Sleep(200 * time.Millisecond)
	for _, m := range l.said("web", ch) {
		if strings.Contains(m, "unrelated") {
			t.Errorf("a later turn's reply said in the channel: %s", m)
		}
	}
}

// Calls kept from before a restart whose turn ended unheard are closed by the next turn's
// start; one whose message still waits in the queue stays open.
func TestCallsOldClosed(t *testing.T) {
	t.Parallel()
	l, ch, second := two(t)
	l.s.calls.add(second, called{Channel: ch, Seq: 1, Input: "0190a7c0-0000-7000-8000-000000000002"})
	// As a new process reads them.
	l.s.calls.of = nil
	l.s.calls.open()
	if code, _ := l.send("web", second, api.Send{Text: "a new turn"}); code != 200 {
		t.Fatalf("send: %d", code)
	}
	l.waitReply("web", second, "ok: a new turn")
	l.waitSaid("web", ch, "@claude2 被叫起（#1）")
	for _, m := range l.said("web", ch) {
		if strings.Contains(m, "a new turn") {
			t.Errorf("a later turn's reply said in the channel: %s", m)
		}
	}
}
