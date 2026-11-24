package server

import (
	"fmt"
	"strings"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/channel"
	"github.com/kumoSleeping/iridium/internal/store"
)

// senderWords names an entry of a subscription's from: zh in Chinese for a line of the channel,
// else in English as the agents are told it.
func (s *Server) senderWords(e string, zh bool) string {
	switch {
	case e == channel.Everyone:
		return cond(zh, "全体成员", "every person")
	case strings.HasPrefix(e, "agent:"):
		id, _ := store.SessionOfMember(e)
		if n := s.ch.Nick(id); n != "" {
			return "@" + n
		}
		return e
	case strings.HasPrefix(e, scriptMemberPrefix):
		return "「" + strings.TrimPrefix(e, scriptMemberPrefix) + "」"
	case strings.HasSuffix(e, "/*"):
		app := strings.TrimSuffix(e, "/*")
		return cond(zh, cmpOr(s.Tag(app), app)+" 全部", "the people of "+cmpOr(s.Tag(app), app))
	}
	for _, p := range s.persons() {
		if p.member == e {
			return p.name
		}
	}
	return e
}

func cmpOr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// onWords says subscriptions as a line of the channel says them, a sentence each, as the page
// does (web/src/chat/channel/scripts.ts triggerLine): 被 @ 时；全体成员说话时；成员加入时 → 欢迎新人.
func (s *Server) onWords(on []api.Trigger) string {
	events := map[string]string{"join": "成员加入", "leave": "成员移出", "rename": "改名", "on": "订阅事件变更", "error": "出错", "ask": "提问"}
	out := []string{"被 @ 时"}
	for _, t := range on {
		var w string
		switch {
		case t.Command != "":
			w = "发送 /" + t.Command + " 时"
		case t.Cron != "":
			w = "定时 " + t.Cron
		case len(t.Event) > 0:
			var evs []string
			for _, e := range t.Event {
				evs = append(evs, cmpOr(events[channel.EventKind(e)], e))
			}
			w = strings.Join(evs, "或") + "时"
		case t.Message != nil:
			var from []string
			for _, e := range t.Message.From {
				from = append(from, s.senderWords(e, true))
			}
			who := strings.Join(from, "、")
			switch {
			case len(t.Message.Words) > 0:
				w = who + "说到「" + strings.Join(t.Message.Words, "」或「") + "」时"
			case who != "":
				w = who + "说话时"
			default:
				w = "有消息时"
			}
		}
		if t.Text != "" {
			w += " → " + t.Text
		}
		out = append(out, w)
	}
	return strings.Join(out, "；")
}

// triggerWords says subscriptions as the agents are told them: "" for none.
func (s *Server) triggerWords(on []api.Trigger) string {
	var out []string
	for _, t := range on {
		var w string
		switch {
		case t.Command != "":
			w = "/" + t.Command
		case t.Cron != "":
			w = fmt.Sprintf("at %q", t.Cron)
		case len(t.Event) > 0:
			w = "on " + strings.Join(t.Event, ", ")
		case t.Message != nil:
			w = "messages"
			if len(t.Message.From) > 0 {
				var from []string
				for _, e := range t.Message.From {
					from = append(from, s.senderWords(e, false))
				}
				w += " of " + strings.Join(from, ", ")
			}
			if len(t.Message.Words) > 0 {
				w += fmt.Sprintf(" with %q", strings.Join(t.Message.Words, `" or "`))
			}
		}
		out = append(out, w)
	}
	return strings.Join(out, "; ")
}
