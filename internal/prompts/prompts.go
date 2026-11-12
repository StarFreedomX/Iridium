// Package prompts is the text layer of what Iridium tells an agent: every fixed word of
// Iridium's that reaches an agent's context, one fragment a file under texts/, and nothing else:
// which fragments go when is policy, putting them together assembly (internal/ctx/assemble),
// handing them over delivery (the drivers).
//
// A fragment's ID is its file's name without ".md" (texts/host.intro.md is "host.intro"). Its
// body is the file's content verbatim, byte for byte: no trimming, no newline added or taken
// away, so a file ends with exactly what the fragment ends with (a line of the system prompt
// with its "\n"; "message.tag" with the space after the bracket and no newline). An editor
// that adds a final newline changes the fragment; assemble's golden tests say so.
//
// A named slot is written {{name}} (lower-case letters, digits, "-", "_"). Render fills them
// in one pass, so a value is never read for slots itself; a slot left without a value and a
// value without a slot are both errors.
//
// ir's help (internal/irhelp) is a text source of its own, cited as "irhelp:<name>".
package prompts

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"
)

//go:embed texts/*.md
var files embed.FS

// Text is one fragment: its ID, its body as the file has it, and Hash, which names that body.
type Text struct {
	ID   string
	Body string
	Hash string
}

var texts = load()

func load() map[string]Text {
	entries, err := files.ReadDir("texts")
	if err != nil {
		panic(err) // the embedded directory: cannot fail once built
	}
	m := make(map[string]Text, len(entries))
	for _, e := range entries {
		b, err := files.ReadFile("texts/" + e.Name())
		if err != nil {
			panic(err)
		}
		id := strings.TrimSuffix(e.Name(), ".md")
		m[id] = Text{ID: id, Body: string(b), Hash: Hash(string(b))}
	}
	return m
}

// Hash names a text: the first 12 hex digits of its SHA-256.
func Hash(body string) string {
	sum := sha256.Sum256([]byte(body))
	return hex.EncodeToString(sum[:6])
}

// Get is the fragment id.
func Get(id string) (Text, bool) {
	t, ok := texts[id]
	return t, ok
}

// IDs are the fragments' IDs, sorted.
func IDs() []string {
	ids := make([]string, 0, len(texts))
	for id := range texts {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

var slot = regexp.MustCompile(`\{\{([a-z0-9_-]+)\}\}`)

// Slots are the names of the fragment's slots, in order, each once.
func (t Text) Slots() []string {
	var names []string
	for _, m := range slot.FindAllStringSubmatch(t.Body, -1) {
		if !slices.Contains(names, m[1]) {
			names = append(names, m[1])
		}
	}
	return names
}

// Render is the body with its slots filled from values. A slot without a value, or a value
// that is no slot of the fragment, is an error.
func (t Text) Render(values map[string]string) (string, error) {
	slots := t.Slots()
	for _, name := range slots {
		if _, ok := values[name]; !ok {
			return "", fmt.Errorf("prompts: %s: no value for {{%s}}", t.ID, name)
		}
	}
	for name := range values {
		if !slices.Contains(slots, name) {
			return "", fmt.Errorf("prompts: %s: no slot {{%s}}", t.ID, name)
		}
	}
	return slot.ReplaceAllStringFunc(t.Body, func(s string) string {
		return values[s[2:len(s)-2]]
	}), nil
}
