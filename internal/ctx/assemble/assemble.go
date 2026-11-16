// Package assemble is the assembly layer of what Iridium gives an agent: it puts fragments of
// text (internal/prompts, internal/irhelp) and values together into an Injection, which
// remembers where each part came from. The layers are apart (the user, 2026-11-12):
//
//   - text: internal/prompts (one fragment a file) and internal/irhelp (ir's help);
//   - policy: which fragments go when (policy.go: pure functions of what is known);
//   - assembly: this file, which resolves a policy's pieces into an Injection;
//   - delivery: the places that hand text to an agent (the system prompt file, a driver's
//     Send) take an Injection, never a string.
//
// An Injection is made only here: its fields are unexported, and what this package exports
// takes fragment IDs of its own choosing and values, so code elsewhere cannot hand an agent a
// string literal of its own. Words that are not Iridium's (a person's message, the words that
// come with a no) go in through Input, marked as such.
package assemble

import (
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/kumoSleeping/iridium/internal/irhelp"
	"github.com/kumoSleeping/iridium/internal/prompts"
)

// Kind is where an Injection goes in an agent's context.
type Kind string

const (
	KindSystem  Kind = "system"  // appended to the agent's system prompt
	KindMessage Kind = "message" // a message's line: the "[tag] " before it, the words, a line of Iridium's own
	// KindTurnPrefix (before a turn's words) has no maker yet.
	KindTurnPrefix Kind = "turn-prefix"
	KindToolResult Kind = "tool-result" // what a tool call of the agent's is answered with
)

// The sources of a part beside "prompts:<id>" and "irhelp:<name>".
const (
	// SourceInput: words that are not Iridium's, as they came: a person's or an app's message,
	// the words given with a no. Its Refs name them (the input's id, the ask's).
	SourceInput = "input"
)

// Ref is data a part cites: an input (Kind "input", ID its id), an ask ("ask"), a fragment a
// value was taken from ("prompts", with its Hash), later a channel's messages From..To.
type Ref struct {
	Kind string `json:"kind"`
	ID   string `json:"id,omitempty"`
	Hash string `json:"hash,omitempty"`
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
}

// Part is one piece of an Injection and where it came from: Source ("prompts:title",
// "irhelp:agent", "input"), the Hash of the source's text (a fragment's body before its slots
// are filled; an input's words), the Values its slots took and the data it cites.
type Part struct {
	Source string            `json:"source"`
	Hash   string            `json:"hash"`
	Values map[string]string `json:"values,omitempty"`
	Refs   []Ref             `json:"refs,omitempty"`

	text string
}

// Injection is text for an agent with its provenance. The zero Injection is empty.
type Injection struct {
	kind  Kind
	parts []Part
}

// Kind is where it goes.
func (in Injection) Kind() Kind { return in.kind }

// String is the exact text given to the agent.
func (in Injection) String() string {
	var b strings.Builder
	for _, p := range in.parts {
		b.WriteString(p.text)
	}
	return b.String()
}

// Parts are its parts in order (a copy).
func (in Injection) Parts() []Part {
	out := make([]Part, len(in.parts))
	for i, p := range in.parts {
		p.Values, p.Refs = maps.Clone(p.Values), slices.Clone(p.Refs)
		out[i] = p
	}
	return out
}

// Record is an Injection as it can be kept: its kind and its parts' provenance, without the
// text (the hashes name it).
type Record struct {
	Kind  Kind   `json:"kind"`
	Parts []Part `json:"parts"`
	// A channel's message (ChannelTurn): Static, the hash of its standing words as they were
	// (ChannelStatic); Full, whether they were given (not Brief); Line, where the agent's record
	// was then, so that a compaction since is seen.
	Static string `json:"static,omitempty"`
	Full   bool   `json:"full,omitempty"`
	Line   int64  `json:"line,omitempty"`
	// Text: all of it as the agent got it (kumo, 2026-11-16: the record shows what it was given,
	// not only where each part is from).
	Text string `json:"text,omitempty"`
}

// Record is what to keep of it, its text whole.
func (in Injection) Record() Record { return Record{Kind: in.kind, Parts: in.Parts(), Text: in.String()} }

// piece is what a policy chooses: a fragment (text) with its slots' values, a part of ir's
// help (help), words that are not Iridium's (words), or the parts of an Injection made before.
type piece struct {
	id     string            // a fragment's ID
	values map[string]string // its slots' values
	fills  map[string]string // slots filled with another fragment's body: slot -> fragment ID
	help   string            // irhelp's part: "agent", "layers", "remote"
	input  bool              // words: not Iridium's
	words  string
	refs   []Ref
	parts  []Part
}

// text is fragment id with its slots' values, as name, value pairs.
func text(id string, kv ...string) piece {
	p := piece{id: id}
	for i := 0; i+1 < len(kv); i += 2 {
		if p.values == nil {
			p.values = map[string]string{}
		}
		p.values[kv[i]] = kv[i+1]
	}
	return p
}

// filled is p with slot filled with the body of fragment id.
func (p piece) filled(slot, id string) piece {
	p.fills = map[string]string{slot: id}
	return p
}

// help is a part of ir's help.
func help(name string) piece { return piece{help: name} }

// words are words that are not Iridium's, as they are.
func words(s string, refs ...Ref) piece { return piece{input: true, words: s, refs: refs} }

// of are the parts of an Injection made before.
func of(in Injection) piece { return piece{parts: in.parts} }

// helps are irhelp's parts by name.
var helps = map[string]func() string{
	"agent":  irhelp.Agent,
	"layers": irhelp.Layers,
	"remote": irhelp.Remote,
}

// build resolves pieces into an Injection of kind.
func build(kind Kind, pieces ...piece) (Injection, error) {
	in := Injection{kind: kind}
	for _, p := range pieces {
		switch {
		case p.parts != nil:
			in.parts = append(in.parts, p.parts...)
		case p.input:
			in.parts = append(in.parts, Part{Source: SourceInput, Hash: prompts.Hash(p.words), Refs: p.refs, text: p.words})
		case p.help != "":
			f, ok := helps[p.help]
			if !ok {
				return Injection{}, fmt.Errorf("assemble: no irhelp part %q", p.help)
			}
			s := f()
			in.parts = append(in.parts, Part{Source: "irhelp:" + p.help, Hash: prompts.Hash(s), text: s})
		default:
			t, ok := prompts.Get(p.id)
			if !ok {
				return Injection{}, fmt.Errorf("assemble: no fragment %q", p.id)
			}
			values, refs := maps.Clone(p.values), slices.Clone(p.refs)
			for slot, id := range p.fills {
				v, ok := prompts.Get(id)
				if !ok {
					return Injection{}, fmt.Errorf("assemble: no fragment %q", id)
				}
				if values == nil {
					values = map[string]string{}
				}
				values[slot] = v.Body
				refs = append(refs, Ref{Kind: "prompts", ID: v.ID, Hash: v.Hash})
			}
			s, err := t.Render(values)
			if err != nil {
				return Injection{}, err
			}
			in.parts = append(in.parts, Part{Source: "prompts:" + t.ID, Hash: t.Hash, Values: values, Refs: refs, text: s})
		}
	}
	return in, nil
}
