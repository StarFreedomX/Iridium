// Package search turns words into the terms a full-text index holds and a query asks for
// (docs/channels.md "搜索"). The index is SQLite's FTS5 with its unicode61 tokenizer, which cuts
// at what is not a letter or a digit: enough for English, for paths (internal/store/store.go is
// four terms) and for names, but a run of Chinese is one long term to it. So a run of Han,
// kana or hangul is written here as its characters and its overlapping pairs ("上下文" as
// "上 上下 下 下文 文"), and a query asks for the pairs of its run (one character alone: itself):
// any characters that follow each other in a message find it, with no dictionary.
package search

import (
	"strings"
	"unicode"
)

// wide: a character of a script written without spaces between words.
func wide(r rune) bool {
	return unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) || unicode.Is(unicode.Hangul, r)
}

// Terms is text as it is indexed: its runs of wide characters as characters and pairs, the
// rest as it is.
func Terms(text string) string {
	var b strings.Builder
	rs := []rune(text)
	for i := 0; i < len(rs); {
		if !wide(rs[i]) {
			b.WriteRune(rs[i])
			i++
			continue
		}
		j := i
		for j < len(rs) && wide(rs[j]) {
			j++
		}
		b.WriteByte(' ')
		for k := i; k < j; k++ {
			b.WriteRune(rs[k])
			b.WriteByte(' ')
			if k+1 < j {
				b.WriteRune(rs[k])
				b.WriteRune(rs[k+1])
				b.WriteByte(' ')
			}
		}
		i = j
	}
	return b.String()
}

// Query is words as an FTS5 query: every term of them must be in the message (of a run of
// wide characters, each pair); a last term of letters may be the start of a word. "" for words
// with no term.
func Query(words string) string {
	var parts []string
	rs := []rune(words)
	for i := 0; i < len(rs); {
		switch {
		case wide(rs[i]):
			j := i
			for j < len(rs) && wide(rs[j]) {
				j++
			}
			if j-i == 1 {
				parts = append(parts, `"`+string(rs[i])+`"`)
			}
			for k := i; k+1 < j; k++ {
				parts = append(parts, `"`+string(rs[k:k+2])+`"`)
			}
			i = j
		case unicode.IsLetter(rs[i]) || unicode.IsDigit(rs[i]):
			j := i
			for j < len(rs) && !wide(rs[j]) && (unicode.IsLetter(rs[j]) || unicode.IsDigit(rs[j])) {
				j++
			}
			term := `"` + strings.ToLower(string(rs[i:j])) + `"`
			if j == len(rs) {
				term += "*"
			}
			parts = append(parts, term)
			i = j
		default:
			i++
		}
	}
	return strings.Join(parts, " ")
}
