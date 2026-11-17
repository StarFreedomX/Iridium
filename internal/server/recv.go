package server

import (
	"fmt"
	"strings"

	"github.com/kumoSleeping/iridium/internal/api"

	"github.com/kumoSleeping/iridium/internal/channel"
	"github.com/kumoSleeping/iridium/internal/store"
)

// recvWords says receive set as a line of the channel says it: "仅 @我" for none, else whom it
// has, by name ("所有人" for every person).
func (s *Server) recvWords(ch string, set []string) string {
	if len(set) == 0 {
		return "仅 @我"
	}
	names := map[string]string{}
	for _, p := range s.persons() {
		names[p.member] = p.name
	}
	var out []string
	for _, e := range set {
		switch {
		case e == channel.Everyone:
			out = append(out, "所有人")
		case strings.HasPrefix(e, "agent:"):
			id, _ := store.SessionOfMember(e)
			if n := s.ch.Nick(id); n != "" {
				out = append(out, "@"+n)
			} else {
				out = append(out, e)
			}
		case strings.HasSuffix(e, "/*"):
			app := strings.TrimSuffix(e, "/*")
			out = append(out, cmpOr(s.Tag(app), app)+" 的所有人")
		default:
			out = append(out, cmpOr(names[e], e))
		}
	}
	return "@我、" + strings.Join(out, "、")
}

func cmpOr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// recvForAgents says receive set as the agents are told it: whom it names, in English; "" for
// none (only what names it).
func (s *Server) recvForAgents(set []string) string {
	if len(set) == 0 {
		return ""
	}
	names := map[string]string{}
	for _, p := range s.persons() {
		names[p.member] = p.name
	}
	var out []string
	for _, e := range set {
		switch {
		case e == channel.Everyone:
			out = append(out, "every person")
		case strings.HasPrefix(e, "agent:"):
			id, _ := store.SessionOfMember(e)
			out = append(out, cmpOr(s.ch.Nick(id), e)+"'s last words")
		case strings.HasSuffix(e, "/*"):
			app := strings.TrimSuffix(e, "/*")
			out = append(out, "the people of "+cmpOr(s.Tag(app), app))
		default:
			out = append(out, cmpOr(names[e], e))
		}
	}
	return strings.Join(out, ", ")
}

// triggerWords says a script's triggers as the agents are told them.
func triggerWords(on []api.Trigger) string {
	var out []string
	for _, t := range on {
		switch {
		case t.Command != "":
			out = append(out, "/"+t.Command)
		case t.Cron != "":
			out = append(out, fmt.Sprintf("at %q", t.Cron))
		case len(t.Event) > 0:
			out = append(out, "on "+strings.Join(t.Event, ", "))
		case t.Message != nil:
			w := "messages"
			if len(t.Message.From) > 0 {
				w += " of " + strings.Join(t.Message.From, ", ")
			}
			if len(t.Message.Words) > 0 {
				w += fmt.Sprintf(" with %q", strings.Join(t.Message.Words, `" or "`))
			}
			out = append(out, w)
		}
	}
	return strings.Join(out, "; ")
}
