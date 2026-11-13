package assemble

import (
	"cmp"
	"strconv"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/activity"
	"github.com/kumoSleeping/iridium/internal/ctx/strategy"
)

// A channel of several agents (docs/channels.md "上下文"): what an agent called there is given.
// The words that call it come first, under their number; then a block of what the channel said
// since the agent last read it, as internal/ctx/strategy planned it.

// ChannelAgent is an agent of the channel: the nick it is called by, the name it goes by.
type ChannelAgent struct{ Nick, Name string }

// Channel is what the agent called is told of the channel. You: its own nick; Agents: all of
// them, itself too; Plan: what it has not seen; Pull: it has ir to read more with; Zone: the
// zone times are written in (nil: UTC). ID, Name: the channel, for an agent that is in it by a
// subscription (docs/channels.md "订阅"): what it says in its turn stays in its own session, and
// it speaks in the channel with ir; none: the channel is the agent's own.
type Channel struct {
	ID     string
	Name   string
	You    string
	Agents []ChannelAgent
	Plan   strategy.Plan
	Pull   bool
	Zone   *time.Location
	// Did: what an agent did before saying a message, by the message's number. Work: what each
	// agent did in all since this one last read the channel, what it has not spoken of yet too.
	Did  map[int64]activity.Activity
	Work []Work
}

// Work is what the agent Who did over a stretch.
type Work struct {
	Who string
	Did activity.Activity
}

// WorkFiles is how many changed files a line of work names.
const WorkFiles = 12

// didPieces say a in few words: "bash 7 (go 4, git 3), 1 failed · 3 files +120 −14 · read 2".
func didPieces(a activity.Activity) []piece {
	var groups [][]piece
	if a.Bash > 0 {
		g := []piece{text(idDidBash, "n", strconv.Itoa(a.Bash))}
		if top := a.Top(3); len(top) > 0 {
			g = append(g, text(idDidCmds, "cmds", strings.Join(top, ", ")))
		}
		if a.Failed > 0 {
			g = append(g, text(idDidFailed, "n", strconv.Itoa(a.Failed)))
		}
		groups = append(groups, g)
	}
	if n := len(a.Files); n > 0 {
		add, del := a.Lines()
		groups = append(groups, []piece{text(idDidFiles, "n", strconv.Itoa(n), "add", strconv.Itoa(add), "del", strconv.Itoa(del))})
	}
	for _, x := range []struct {
		id string
		n  int
	}{{idDidRead, a.Read}, {idDidWeb, a.Search + a.Fetch}, {idDidAgents, a.Agents}, {idDidOther, a.Other}} {
		if x.n > 0 {
			groups = append(groups, []piece{text(x.id, "n", strconv.Itoa(x.n))})
		}
	}
	var ps []piece
	for i, g := range groups {
		if i > 0 {
			ps = append(ps, text(idDidSep))
		}
		ps = append(ps, g...)
	}
	return ps
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
	// The channel as ir takes it: the agent's own is "self".
	self := cmp.Or(c.ID, "self")
	ps := []piece{text(idChannelMessage, "seq", n(seq)), words(said, append(refs, Ref{Kind: "message", ID: n(seq)})...), text(idChannelOpen)}
	var agents []string
	for _, a := range c.Agents {
		s := a.Nick // without @: the agent echoing the list calls nobody
		if a.Name != "" {
			s += " (" + a.Name + ")"
		}
		agents = append(agents, s)
	}
	if c.ID != "" {
		ps = append(ps, text(idChannelGuest, "you", c.You, "channel", c.ID, "name", cmp.Or(c.Name, c.ID), "agents", strings.Join(agents, ", ")))
	} else {
		ps = append(ps, text(idChannelMembers, "you", c.You, "agents", strings.Join(agents, ", ")))
	}
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
			ps = append(ps, text(idChannelLine, "seq", n(m.Seq), "who", m.Who, "time", time.UnixMilli(m.At).In(zone).Format("01-02 15:04")))
			if did, ok := c.Did[m.Seq]; ok && !did.Empty() {
				ps = append(append(ps, text(idChannelLineDid)), didPieces(did)...)
			}
			ps = append(ps, text(idChannelLineEnd), words(m.Text, Ref{Kind: "message", ID: n(m.Seq)}))
			if m.Left > 0 {
				ps = append(ps, text(idChannelCut, "left", strconv.Itoa(m.Left), "seq", n(m.Seq), "channel", self))
			}
			ps = append(ps, text(idNL))
		}
	}
	work := false
	for _, w := range c.Work {
		if w.Did.Empty() {
			continue
		}
		if !work {
			ps, work = append(ps, text(idChannelWork)), true
		}
		ps = append(append(ps, text(idChannelWorkLine, "who", w.Who)), didPieces(w.Did)...)
		if len(w.Did.Files) > 0 {
			var paths []string
			for i, f := range w.Did.Files {
				if i >= WorkFiles {
					paths = append(paths, "…")
					break
				}
				paths = append(paths, f.Path)
			}
			ps = append(ps, text(idChannelWorkFile, "files", strings.Join(paths, ", ")))
		}
		ps = append(ps, text(idNL))
	}
	if c.Pull {
		ps = append(ps, text(idChannelPull, "channel", self))
	}
	return append(ps, text(idChannelClose))
}
