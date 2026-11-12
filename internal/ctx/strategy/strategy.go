// Package strategy is the policy layer of the context an agent of a channel is given
// (docs/channels.md "上下文"): pure functions from a channel's messages the agent has not seen
// and a budget to what to give in full, what to list and what to leave out. It writes no words:
// internal/ctx/assemble puts its result into text.
package strategy

import (
	"strings"
	"unicode/utf8"
)

// Msg is a message of a channel as the strategies see it.
type Msg struct {
	Seq   int64
	Who   string // the name its author goes by in the channel
	Agent bool   // an agent's words, not a person's
	Text  string
	At    int64 // ms
}

// Budget bounds what is given. Bytes: the whole of it; Message: the most characters of one
// message given in full; Turns: the most turns listed; Head: the most characters of a turn's
// first words.
type Budget struct {
	Bytes   int
	Message int
	Turns   int
	Head    int
}

// Default is the budget of a turn's prefix.
var Default = Budget{Bytes: 24 << 10, Message: 2000, Turns: 30, Head: 80}

// Full is a message given in full; Left: how many characters of it were cut off its end.
type Full struct {
	Msg
	Left int
}

// Turn is a run of messages listed in one line: a person's message and what the agents said
// until the next person's (From..To their numbers). Who asked, Head their first words; Answered,
// the agents that spoke.
type Turn struct {
	From, To int64
	Who      string
	Head     string
	Answered []string
}

// Plan is what an agent is given of the messages it has not seen. Skipped: the earliest, not
// even listed (their numbers From..To, Count of them); Turns: listed, a line each; Full: the
// latest, in full. Each part may be empty.
type Plan struct {
	Skipped struct {
		From, To int64
		Count    int
	}
	Turns []Turn
	Full  []Full
}

// Fold plans unseen (in order) under b: the latest messages in full, back from the newest, cut
// only between messages, for two thirds of the bytes; the ones before listed by turn, the
// latest b.Turns of them; the rest skipped.
func Fold(unseen []Msg, b Budget) Plan {
	var p Plan
	if len(unseen) == 0 {
		return p
	}
	left := b.Bytes * 2 / 3
	cut := len(unseen)
	for cut > 0 {
		f := clip(unseen[cut-1], b.Message)
		size := len(f.Text) + len(f.Who) + 48
		if size > left && cut < len(unseen) {
			break
		}
		left -= size
		p.Full = append(p.Full, f)
		cut--
		if left <= 0 {
			break
		}
	}
	for i, j := 0, len(p.Full)-1; i < j; i, j = i+1, j-1 {
		p.Full[i], p.Full[j] = p.Full[j], p.Full[i]
	}
	turns := turnsOf(unseen[:cut], b.Head)
	left = b.Bytes / 3
	keep := len(turns)
	for keep > 0 && len(turns)-keep < b.Turns {
		t := turns[keep-1]
		size := len(t.Head) + len(t.Who) + 40 + 12*len(t.Answered)
		if size > left {
			break
		}
		left -= size
		keep--
	}
	p.Turns = turns[keep:]
	if keep > 0 {
		p.Skipped.From, p.Skipped.To = turns[0].From, turns[keep-1].To
		for _, m := range unseen[:cut] {
			if m.Seq <= p.Skipped.To {
				p.Skipped.Count++
			}
		}
	}
	return p
}

// clip is m in full, its text cut to max characters.
func clip(m Msg, max int) Full {
	f := Full{Msg: m}
	if max > 0 && utf8.RuneCountInString(m.Text) > max {
		r := []rune(m.Text)
		f.Text, f.Left = string(r[:max]), len(r)-max
	}
	return f
}

// turnsOf groups ms into turns: a new one at each person's message; agents speaking before any
// person are a turn of their own.
func turnsOf(ms []Msg, head int) []Turn {
	var out []Turn
	for _, m := range ms {
		if !m.Agent || len(out) == 0 {
			out = append(out, Turn{From: m.Seq, To: m.Seq, Who: m.Who, Head: headOf(m.Text, head)})
			continue
		}
		t := &out[len(out)-1]
		t.To = m.Seq
		if m.Who != t.Who && !contains(t.Answered, m.Who) {
			t.Answered = append(t.Answered, m.Who)
		}
	}
	return out
}

func contains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

// headOf is the first words of text: its first line that says something, at most max characters.
func headOf(text string, max int) string {
	for _, line := range strings.Split(text, "\n") {
		line = strings.Join(strings.Fields(line), " ")
		if line == "" {
			continue
		}
		if r := []rune(line); max > 0 && len(r) > max {
			return string(r[:max]) + "…"
		}
		return line
	}
	return ""
}
