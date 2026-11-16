// Package deliver decides who a message said in a channel wakes (docs/channels.md "投递"): pure
// rules over the message's words, who said it and the channel's agents. It sends nothing.
package deliver

import (
	"strings"
	"unicode"
)

// MaxHops is how many agents in a row may pass a chain on since a person last spoke.
const MaxHops = 4

// Agent is an agent of the channel: the session it is, the nick it is called by, and whether
// it receives everything people say (All) or only what names it.
type Agent struct {
	Session string
	Nick    string
	All     bool
}

// Decision is what a message does. Wake: the sessions it is delivered to, in the channel's
// order; Named: the nicks it names (itself aside).
type Decision struct {
	Wake  []string
	Named []string
}

// The two names that call more than one (the user, 2026-11-13): "@全体成员", everyone in the
// channel, and "@全体Agent", its agents. For the agents both are the same: each is woken as if
// named. No nick may be one of them.
const (
	AllMembers = "全体成员"
	AllAgents  = "全体Agent"
)

// Reserved: n is one of the names that call more than one, whatever its case.
func Reserved(n string) bool {
	return strings.EqualFold(n, AllMembers) || strings.EqualFold(n, AllAgents)
}

// Route decides for a message with words text. from: the session of the agent that said it,
// "" for a person. A person's message wakes
// the agents it names; one that names none, those that receive everything (they read the rest
// when next called). An agent's wakes only those it names: agents do not wake each other by
// merely speaking. How many agents in a row may pass a message on (MaxHops) is counted by the
// channel, by whoever sends.
func Route(text, from string, agents []Agent) Decision {
	var nicks []string
	for _, a := range agents {
		if a.Session != from {
			nicks = append(nicks, a.Nick)
		}
	}
	var d Decision
	d.Named = Mentions(text, nicks)
	if all := Mentions(text, []string{AllMembers, AllAgents}); len(all) > 0 {
		d.Named = nicks // all of them, as if each were named
	}
	named := map[string]bool{}
	for _, n := range d.Named {
		named[strings.ToLower(n)] = true
	}
	for _, a := range agents {
		if a.Session == from {
			continue
		}
		if named[strings.ToLower(a.Nick)] || (from == "" && a.All && len(d.Named) == 0) {
			d.Wake = append(d.Wake, a.Session)
		}
	}
	return d
}

// ValidNick: a nick is letters, digits, "_" and "-", at most 32 of them, so that "@nick"
// stands out of any words; not one of the names that call more than one.
func ValidNick(n string) bool {
	if n == "" || len([]rune(n)) > 32 || Reserved(n) {
		return false
	}
	for _, r := range n {
		if !nickRune(r) {
			return false
		}
	}
	return true
}

// NickFrom is a nick made of name (a session's name): its letters, digits, _ and -, at most
// 32; "" if that is no nick.
func NickFrom(name string) string {
	var b strings.Builder
	n := 0
	for _, r := range name {
		if nickRune(r) && n < 32 {
			b.WriteRune(r)
			n++
		}
	}
	if !ValidNick(b.String()) {
		return ""
	}
	return b.String()
}

func nickRune(r rune) bool {
	return r == '_' || r == '-' || unicode.IsLetter(r) || unicode.IsDigit(r)
}

// Mentions are the nicks (of those given, as given, each once, in the order named) that text
// calls: "@nick" standing by itself (not inside a word, an address or a longer name), outside
// code (a fenced block, an inline span) and outside quoted lines ("> "). Case does not matter.
func Mentions(text string, nicks []string) []string {
	if len(nicks) == 0 || !strings.Contains(text, "@") {
		return nil
	}
	by := map[string]string{}
	for _, n := range nicks {
		by[strings.ToLower(n)] = n
	}
	var out []string
	seen := map[string]bool{}
	fenced := false
	for _, line := range strings.Split(text, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "```") || strings.HasPrefix(t, "~~~") {
			fenced = !fenced
			continue
		}
		if fenced || strings.HasPrefix(t, ">") {
			continue
		}
		rs := []rune(line)
		code := false
		for i := 0; i < len(rs); i++ {
			switch {
			case rs[i] == '`':
				code = !code
			case rs[i] == '@' && !code && (i == 0 || !nickRune(rs[i-1]) && rs[i-1] != '@' && rs[i-1] != '/' && rs[i-1] != '.'):
				j := i + 1
				for j < len(rs) && nickRune(rs[j]) {
					j++
				}
				if n, ok := by[strings.ToLower(string(rs[i+1:j]))]; ok && !seen[n] {
					seen[n] = true
					out = append(out, n)
				}
				i = j - 1
			}
		}
	}
	return out
}
