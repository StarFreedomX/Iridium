package assemble

import (
	"strconv"
	"strings"

	"github.com/kumoSleeping/iridium/internal/prompts"
)

// Text is the part's text as it was given, where the part is one of an Injection made here or
// one Split read back out of a Record ("" for a Record's part as kept).
func (p Part) Text() string { return p.text }

// Split reads r's text back into its parts (kumo, 2026-11-26: what an agent was given is shown
// as it was, to the character): each fragment's text is rendered again from its values, and the
// words that are not Iridium's (input) are what lies between. Head and tail are what the text
// has before and after them (a sender's tag "[kumo] " the session put before a channel's
// message, a line added after it). Not ok: no text kept, a part from ir's help, or a fragment
// changed since (its hash), or the text not as its parts make it.
func (r Record) Split() (head string, parts []Part, tail string, ok bool) {
	if r.Text == "" || len(r.Parts) == 0 {
		return "", nil, "", false
	}
	// Each part's text, where it is Iridium's own.
	known := make([]bool, len(r.Parts))
	parts = make([]Part, len(r.Parts))
	for i, p := range r.Parts {
		parts[i] = p
		switch {
		case p.Source == SourceInput:
		case strings.HasPrefix(p.Source, "prompts:"):
			t, found := prompts.Get(strings.TrimPrefix(p.Source, "prompts:"))
			if !found || t.Hash != p.Hash {
				return "", nil, "", false
			}
			s, err := t.Render(p.Values)
			if err != nil {
				return "", nil, "", false
			}
			parts[i].text, known[i] = s, true
		default:
			return "", nil, "", false
		}
	}
	// The runs of known parts between the words: the words end where the run after them starts.
	text := r.Text
	at := 0
	for i := 0; i < len(parts); {
		j := i
		var run strings.Builder
		for j < len(parts) && known[j] {
			run.WriteString(parts[j].text)
			j++
		}
		s := run.String()
		if i == 0 {
			// The first run: what is before it is the head.
			k := strings.Index(text, s)
			if k < 0 {
				return "", nil, "", false
			}
			head, at = text[:k], k+len(s)
		} else {
			// Words (part i-1) up to this run: where the run comes again inside them, the place
			// whose words have the hash kept is theirs; without one, the first place (the last
			// run: the last place).
			k := wordsEnd(text[at:], s, parts[i-1].Hash, j == len(parts))
			if k < 0 || s == "" && j < len(parts) {
				return "", nil, "", false
			}
			parts[i-1].text = text[at : at+k]
			at += k + len(s)
		}
		if j == len(parts) {
			break
		}
		// Part j is words: the next run (from j+1) ends them; words last of all run to the end.
		if j == len(parts)-1 {
			parts[j].text, at = text[at:], len(text)
			break
		}
		if known[j+1] {
			i = j + 1
			continue
		}
		return "", nil, "", false // two words side by side: nothing tells where one ends
	}
	return head, parts, text[at:], true
}

// wordsEnd is where in text words end that run follows: the place of run after which the words
// before it hash to hash; none so, the first place of run (last: its last place). -1: no run.
func wordsEnd(text, run, hash string, last bool) int {
	first, lastAt := -1, -1
	for k := 0; k <= len(text); {
		n := strings.Index(text[k:], run)
		if n < 0 {
			break
		}
		at := k + n
		if hash != "" && prompts.Hash(text[:at]) == hash {
			return at
		}
		if first < 0 {
			first = at
		}
		lastAt = at
		if run == "" {
			break
		}
		k = at + 1
	}
	if last {
		return lastAt
	}
	return first
}

// Given is a message of a channel as an agent of it was given it, read out of the record:
// ID its number ("3-5" for a turn told in a line), who said it and its words, as written there.
type Given struct {
	ID    string
	Seq   int64 // its number; a turn's first
	Who   string
	Words string // the words given: cut ones with how to get the rest, a turn's head with who answered
	Turn  bool
}

// Messages are the messages a channel's message gave an agent (ChannelTurn, ChannelReaction):
// those in its context's lines (a turn in a line, a message in full), in order, and the one that
// called it last (Who empty: its line names nobody), each as given. Not ok where the record
// cannot be split (Split) or is no channel's.
func (r Record) Messages() ([]Given, bool) {
	_, parts, _, ok := r.Split()
	if !ok {
		return nil, false
	}
	var out []Given
	var call *Given
	var cur *Given
	inCtx := false
	flush := func() {
		if cur != nil {
			out = append(out, *cur)
			cur = nil
		}
	}
	for _, p := range parts {
		id := strings.TrimPrefix(p.Source, "prompts:")
		switch {
		case id == idChannelOpen:
			inCtx = true
		case id == idChannelClose:
			flush()
			inCtx = false
		case !inCtx:
			// Before the context: the message that called it, its words all but its number.
			if call == nil {
				call = &Given{}
			}
			switch {
			case id == idChannelMessage:
				call.Seq, _ = strconv.ParseInt(p.Values["seq"], 10, 64)
			case id == idChannelReaction:
				call.Seq, _ = strconv.ParseInt(p.Values["seq"], 10, 64)
				call.Words += p.Text()
			default:
				call.Words += p.Text()
			}
		case id == idChannelTurn:
			flush()
			from, _ := strconv.ParseInt(p.Values["from"], 10, 64)
			cur = &Given{ID: p.Values["from"] + "-" + p.Values["to"], Seq: from, Who: p.Values["who"], Words: p.Values["head"], Turn: true}
		case id == idChannelAnswered || id == idChannelCut:
			if cur != nil {
				cur.Words += p.Text()
			}
		case id == idChannelLine:
			flush()
			seq, _ := strconv.ParseInt(p.Values["seq"], 10, 64)
			cur = &Given{ID: p.Values["seq"], Seq: seq, Who: p.Values["who"]}
		case p.Source == SourceInput:
			if cur != nil {
				cur.Words += p.Text()
			}
		case id == idNL:
			flush()
		case cur != nil && cur.Words == "" && !cur.Turn:
			// What its agent did before it, and "]: ": not its words.
		default:
			flush()
		}
	}
	flush()
	if call == nil || call.Seq == 0 {
		return nil, false
	}
	call.ID = strconv.FormatInt(call.Seq, 10)
	return append(out, *call), true
}
