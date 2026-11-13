package satori

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/kumoSleeping/iridium/internal/activity"
	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/channel"
	"github.com/kumoSleeping/iridium/internal/transcript"
)

// A session's record in outline (internal/block.outline, docs/channels.md "读记录"): between
// what an agent did in counts (a channel message's activity) and the record whole (block.list),
// a line a turn: who asked and their first words, what the agent did, its last words. Each turn
// says where it is in the record, so that block.list reads it whole.

const (
	// OutlineTurns is how many turns an outline holds when none is asked; OutlineMax, at most.
	OutlineTurns = 30
	OutlineMax   = 200
	// outlineBlocks is how many blocks of the record an outline reads at most.
	outlineBlocks = 4000
	// outlineHead is how many characters of a turn's words it keeps.
	outlineHead = 200
)

// offsetOf is the line of the record block at is on.
func offsetOf(at string) int64 {
	n, _, _ := strings.Cut(at, ".")
	v, _ := strconv.ParseInt(n, 10, 64)
	return v
}

// head is the start of text in one line, at most outlineHead characters.
func head(text string) string {
	text = strings.Join(strings.Fields(transcript.WithoutNameLines(text)), " ")
	if r := []rune(text); len(r) > outlineHead {
		return string(r[:outlineHead]) + "…"
	}
	return text
}

// blockOutline is the outline of a session's record: the latest turns that end before line
// `to` (none: the record's end) and begin after line `from` (none: its start), in order.
func (s *Service) blockOutline(_ context.Context, c Caller, body []byte) (any, error) {
	var req struct {
		ChannelID string `json:"channel_id"`
		From      string `json:"from"`
		To        string `json:"to"`
		Limit     int    `json:"limit"`
	}
	if err := decode(body, &req); err != nil {
		return nil, err
	}
	st, err := s.channel(c, req.ChannelID)
	if err != nil {
		return nil, err
	}
	num := func(v, name string) (int64, error) {
		if v == "" {
			return -1, nil
		}
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			return 0, bad(name + ": a line of the record (a block's id before the dot)")
		}
		return n, nil
	}
	from, err := num(req.From, "from")
	if err != nil {
		return nil, err
	}
	to, err := num(req.To, "to")
	if err != nil {
		return nil, err
	}
	limit := req.Limit
	if limit <= 0 {
		limit = OutlineTurns
	}
	limit = min(limit, OutlineMax)

	// Pages of the record, backward from `to`, until there are turns enough.
	var blocks []api.Block
	out := api.Outline{Turns: []api.OutlineTurn{}}
	turns := 0
	for pos := to; ; {
		p, err := s.b.Messages(st.ID, pos, -1)
		if err != nil {
			return nil, err
		}
		if out.End == 0 {
			out.End = p.End
		}
		for _, b := range p.Blocks {
			if b.Kind == api.BlockKindUser {
				turns++
			}
		}
		blocks = append(append([]api.Block{}, p.Blocks...), blocks...)
		out.More = p.More
		if !p.More || len(p.Blocks) == 0 || p.Start <= max(from, 0) || turns > limit || len(blocks) > outlineBlocks {
			break
		}
		pos = p.Start
	}
	var cur *api.OutlineTurn
	var did activity.Activity
	flush := func() {
		if cur == nil {
			return
		}
		if !did.Empty() {
			d := did
			d.First = 0
			cur.Did, _ = json.Marshal(d)
		}
		out.Turns = append(out.Turns, *cur)
		cur, did = nil, activity.Activity{}
	}
	for _, b := range blocks {
		if offsetOf(b.At) <= from {
			continue
		}
		switch b.Kind {
		case api.BlockKindUser:
			flush()
			text := b.Text
			if channel.Given(text) {
				text, _, _ = strings.Cut(text, "\n") // a channel's message: its words, not the context
			}
			cur = &api.OutlineTurn{At: b.At, End: b.At, Time: b.Time, From: b.From, Asked: s.b.Mask(head(text))}
		case api.BlockKindAssistant:
			if cur == nil {
				cur = &api.OutlineTurn{At: b.At, Time: b.Time}
			}
			if strings.TrimSpace(b.Text) != "" {
				cur.Said, cur.Words = s.b.Mask(head(b.Text)), cur.Words+1
			}
			cur.End = b.At
		case api.BlockKindTool:
			if cur == nil {
				cur = &api.OutlineTurn{At: b.At, Time: b.Time}
			}
			did.Add(activity.Call{Name: b.Name, Input: b.Input, Failed: b.Result != nil && b.Result.Error, At: b.Time})
			cur.End = b.At
		}
	}
	flush()
	if len(out.Turns) > limit {
		out.Turns, out.More = out.Turns[len(out.Turns)-limit:], true
	}
	if len(out.Turns) > 0 {
		out.Start = offsetOf(out.Turns[0].At)
	}
	return out, nil
}
