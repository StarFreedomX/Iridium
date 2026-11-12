package assemble

import (
	"strconv"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/ctx/strategy"
)

// A channel of several agents (docs/channels.md "上下文"): what an agent called there is given.
// The words that call it come first, under their number; then a block of what the channel said
// since the agent last read it, as internal/ctx/strategy planned it.

// ChannelAgent is an agent of the channel: the nick it is called by, the name it goes by.
type ChannelAgent struct{ Nick, Name string }

// Channel is what the agent called is told of its channel. You: its own nick; Agents: all of
// them, itself too; Plan: what it has not seen; Pull: it has ir to read more with; Zone: the
// zone times are written in (nil: UTC).
type Channel struct {
	You    string
	Agents []ChannelAgent
	Plan   strategy.Plan
	Pull   bool
	Zone   *time.Location
}

// ChannelTurn is what an agent of a channel gets for message seq (said, the input it is):
// "#seq: " and the words, then the channel's context.
func ChannelTurn(c Channel, seq int64, said, input string) (Injection, error) {
	return build(KindTurnPrefix, channelPieces(c, seq, said, input)...)
}

func n(i int64) string { return strconv.FormatInt(i, 10) }

func channelPieces(c Channel, seq int64, said, input string) []piece {
	var refs []Ref
	if input != "" {
		refs = []Ref{{Kind: "input", ID: input}}
	}
	ps := []piece{text(idChannelMessage, "seq", n(seq)), words(said, append(refs, Ref{Kind: "message", ID: n(seq)})...), text(idChannelOpen)}
	var agents []string
	for _, a := range c.Agents {
		s := a.Nick // without @: the agent echoing the list calls nobody
		if a.Name != "" {
			s += " (" + a.Name + ")"
		}
		agents = append(agents, s)
	}
	ps = append(ps, text(idChannelMembers, "you", c.You, "agents", strings.Join(agents, ", ")))
	p := c.Plan
	if k := p.Skipped; k.Count > 0 {
		sk := text(idChannelSkipped, "from", n(k.From), "to", n(k.To), "count", strconv.Itoa(k.Count))
		sk.refs = []Ref{{Kind: "messages", From: n(k.From), To: n(k.To)}}
		ps = append(ps, sk)
	}
	if len(p.Turns) > 0 {
		ps = append(ps, text(idChannelListed))
		for _, t := range p.Turns {
			line := text(idChannelTurn, "from", n(t.From), "to", n(t.To), "who", t.Who, "head", t.Head)
			line.refs = []Ref{{Kind: "messages", From: n(t.From), To: n(t.To)}}
			ps = append(ps, line)
			if len(t.Answered) > 0 {
				ps = append(ps, text(idChannelAnswered, "who", strings.Join(t.Answered, ", ")))
			}
			ps = append(ps, text(idNL))
		}
	}
	if len(p.Full) > 0 {
		ps = append(ps, text(idChannelFull))
		zone := c.Zone
		if zone == nil {
			zone = time.UTC
		}
		for _, m := range p.Full {
			ps = append(ps, text(idChannelLine, "seq", n(m.Seq), "who", m.Who, "time", time.UnixMilli(m.At).In(zone).Format("01-02 15:04")),
				words(m.Text, Ref{Kind: "message", ID: n(m.Seq)}))
			if m.Left > 0 {
				ps = append(ps, text(idChannelCut, "left", strconv.Itoa(m.Left), "seq", n(m.Seq)))
			}
			ps = append(ps, text(idNL))
		}
	}
	if c.Pull {
		ps = append(ps, text(idChannelPull))
	}
	return append(ps, text(idChannelClose))
}
