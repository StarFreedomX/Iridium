package server

import (
	"strings"
	"testing"
	"time"

	"github.com/kumoSleeping/iridium/internal/api"
)

// Subscriptions beside words (docs/channels.md "订阅事件"): an event wakes an agent with the
// words it was given; a time does, said in the channel; two agents that wake each other are
// warned of as the second is set.
func TestSubscriptions(t *testing.T) {
	t.Parallel()
	l := start(t)
	ch := l.create(200, "web", api.NewSession{Agent: api.AgentClaude, Cwd: l.work, Text: "first"})
	l.waitReply("web", ch, "ok: first")
	var ms api.ChannelMembers
	l.want(200, "web", "POST", "/v1/internal/channels/"+ch+"/members", api.NewMember{Agent: api.AgentClaude, Nick: "greeter", On: []api.Trigger{{Event: []string{"join"}, Text: "say hello"}}}, &ms)
	greeter := ms.Members[len(ms.Members)-1].Session
	l.idle(greeter)

	// Another joins: the greeter is woken by it, given its subscription's words.
	l.want(200, "web", "POST", "/v1/internal/channels/"+ch+"/members", api.NewMember{Agent: api.AgentClaude, Nick: "late"}, &ms)
	l.waitSaid("web", ch, "@greeter ", "late", "[subscription] say hello")

	// A time: a line of the channel, then the agent woken by it.
	tick := []api.Trigger{{Cron: "* * * * *", Text: "tick"}}
	l.want(200, "web", "PATCH", "/v1/internal/channels/"+ch+"/members/agent:"+greeter, api.MemberPatch{On: &tick}, nil)
	l.idle(greeter)
	l.s.cronAgents(time.Now().Truncate(time.Minute))
	l.waitSaid("web", ch, "iridium", "定时", "@greeter")
	l.waitSaid("web", ch, "@greeter ", "[subscription] tick")

	// A ring: the first wakes on the greeter's last words, the greeter on the first's.
	l.idle(greeter)
	l.idle(ch)
	on := onFrom("agent:" + ch)
	l.want(200, "web", "PATCH", "/v1/internal/channels/"+ch+"/members/agent:"+greeter, api.MemberPatch{On: &on}, &ms)
	if len(ms.Warn) != 0 {
		t.Errorf("no ring yet: %v", ms.Warn)
	}
	back := onFrom("*", "agent:"+greeter)
	l.want(200, "web", "PATCH", "/v1/internal/channels/"+ch+"/members/agent:"+ch, api.MemberPatch{On: &back}, &ms)
	if len(ms.Warn) != 1 || !strings.Contains(ms.Warn[0], "loop: ") || !strings.Contains(ms.Warn[0], "@greeter") {
		t.Errorf("the ring: %v", ms.Warn)
	}
	l.waitSaid("web", ch, "iridium", "唤醒：")
}
