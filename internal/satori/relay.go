package satori

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/kumoSleeping/iridium/internal/activity"
	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/store"
)

// A channel's message as an agent of it was given it, in that agent's own record (docs/channels.md
// "增量", "网页"): Satori's forward, a <message forward> of the messages it was given this time
// (each a <message> with its <author>), the one that called it last; before it
//
//	<iridium:relay channel name seq full>the channel's standing words</iridium:relay>
//
// which channel, the number of the message that called it, and, where they were given this time
// (full), the channel's standing words. A client that knows only Satori sees the forward.
const elRelay = Adapter + ":relay"

// Relay is what a channel gave an agent with one of its messages.
type Relay struct {
	Channel string
	Name    string
	Seq     int64
	Full    bool
	Context string // the standing words, where Full
	Msgs    []RelayMsg
}

// RelayMsg is a message of the forward: ID its number ("3-5" for a turn told in a line), who
// said it, its words, what its agent did before saying it.
type RelayMsg struct {
	ID       string
	User     User
	Text     string
	Activity *activity.Activity
	Turn     bool // a turn in a line (its first words), not the words whole
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
	rl := Tag(elRelay, kv)
	if r.Full {
		rl.Attrs = append(rl.Attrs, Attr{Key: "full", Bare: true})
		if r.Context != "" {
			rl.Children = []Element{Text(mask(r.Context))}
		}
	}
	out := head + String([]Element{rl}) + "<message forward>"
	for _, m := range r.Msgs {
		au := Tag("author", []string{"id", m.User.ID, "name", mask(m.User.Name)})
		msg := String([]Element{au, Text(mask(m.Text))})
		if m.Turn {
			msg += String([]Element{Tag(Adapter+":turn", nil)})
		}
		msg += activityElement(m.Activity, false)
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
			e := els[0]
			if id, ok := store.SessionOfMember(e.Attr("id")); ok && nick != nil {
				if n := nick(id); n != "" {
					return "@" + n
				}
			}
			return Plain(els, nil)
		})
	})
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
