package satori

import (
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/store"
)

// A channel's message as an agent of it was given it, in that agent's own record (docs/channels.md
// "增量", "网页"): Satori's forward, a <message forward> of the messages it was given this time
// (each a <message> with its <author>, its words as the agent got them), the one that called it
// last; before it
//
//	<iridium:relay channel name seq/>
//
// which channel and the number of the message that called it, to go there. Only the standard
// forward and those plain attributes: what else Iridium gave (its standing words, the lines of
// its <channel-context>) is the internal interface's, the session's injections (kumo, 2026-11-26:
// the standard interface and the internal one kept apart). A client that knows only Satori sees
// the forward.
const elRelay = Adapter + ":relay"

// Relay is what a channel gave an agent with one of its messages.
type Relay struct {
	Channel string
	Name    string
	Seq     int64
	Msgs    []RelayMsg
}

// RelayMsg is a message of the forward: ID its number ("3-5" for a turn told in a line), who
// said it, its words as the agent was given them.
type RelayMsg struct {
	ID   string
	User User
	Text string
	Turn bool // a turn in a line (its first words), not the words whole
}

// Relayer is a Backend that knows what its channels gave their agents.
type Relayer interface {
	// Relay is what block b of session's record is, if it is a channel's message given to it.
	Relay(session string, b api.Block) (Relay, bool)
}

// relayContent is user block b as the relay r: its mark, the relay, the forward.
func relayContent(b api.Block, r Relay, mask func(string) string) string {
	mark := b
	mark.Text = ""
	head := blockContent(mark, "", "", "", mask)
	kv := []string{"channel", r.Channel, "name", mask(r.Name), "seq", strconv.FormatInt(r.Seq, 10)}
	out := head + String([]Element{Tag(elRelay, kv)}) + "<message forward>"
	for _, m := range r.Msgs {
		kv := []string{"name", mask(m.User.Name)}
		if m.User.ID != "" {
			kv = append([]string{"id", m.User.ID}, kv...)
		}
		msg := String([]Element{Tag("author", kv), Text(mask(m.Text))})
		if m.Turn {
			msg += String([]Element{Tag(Adapter+":turn", nil)})
		}
		out += `<message id="` + Escape(m.ID) + `">` + msg + "</message>"
	}
	return out + "</message>"
}

// atTag is an <at …/> (or <at …>…</at>) written in words.
var atTag = regexp.MustCompile(`<at(\s[^<>]*?)?\s*(?:/>|>([^<]*)</at>)`)

// AtWords is text with each <at> written in it (outside code) as the words that call it: "@"
// and its name, "@全体成员" for <at type="all"/>, "@全体Agent" for <at role="agent"/>; an
// agent's (id "agent:<session>") by nick when nick knows it (docs/channels.md "叫起谁": Markdown
// and Satori's elements may be mixed in what is said, Iridium reads both).
func AtWords(text string, nick func(session string) string) string {
	if !strings.Contains(text, "<at") {
		return text
	}
	return outsideCode(text, func(s string) string {
		return atTag.ReplaceAllStringFunc(s, func(tag string) string {
			els := Parse(tag)
			if len(els) != 1 || els[0].Type != "at" {
				return tag
			}
			return Plain([]Element{atNick(els[0], nick)}, nil)
		})
	})
}

// Ats are the <at> elements written in text, outside code, in order: whom its words name the
// way Satori does (id, name, type "all", role).
func Ats(text string) []Element {
	if !strings.Contains(text, "<at") {
		return nil
	}
	var out []Element
	outsideCode(text, func(s string) string {
		for _, tag := range atTag.FindAllString(s, -1) {
			if els := Parse(tag); len(els) == 1 && els[0].Type == "at" {
				out = append(out, els[0])
			}
		}
		return s
	})
	return out
}

// atNick is e, if it is an <at> of an agent (id "agent:<session>") that nick knows, named by
// that nick: as text it is then "@nick". The one place an <at> becomes a nick, for the
// elements of a message (atNicks) and for those written in its words (AtWords).
func atNick(e Element, nick func(session string) string) Element {
	if e.Type != "at" || nick == nil {
		return e
	}
	if id, ok := store.SessionOfMember(e.Attr("id")); ok {
		if n := nick(id); n != "" {
			e.Attrs = append([]Attr{{Key: "name", Value: n}}, slices.DeleteFunc(slices.Clone(e.Attrs), func(a Attr) bool { return a.Key == "name" })...)
		}
	}
	return e
}

// outsideCode applies f to the parts of Markdown text outside fenced blocks and inline code.
func outsideCode(text string, f func(string) string) string {
	var b strings.Builder
	fenced := false
	lines := strings.SplitAfter(text, "\n")
	for _, line := range lines {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "```") || strings.HasPrefix(t, "~~~") {
			fenced = !fenced
			b.WriteString(line)
			continue
		}
		if fenced {
			b.WriteString(line)
			continue
		}
		parts := strings.Split(line, "`")
		for i, p := range parts {
			if i > 0 {
				b.WriteString("`")
			}
			if i%2 == 0 {
				p = f(p)
			}
			b.WriteString(p)
		}
	}
	return b.String()
}
