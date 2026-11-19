package transcript

import (
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

// A reply's title line (plan "会话标题"): told so (assemble.System), the agent ends a reply
// with a line [标题] text when the session has no fitting title yet or its subject has changed.
// The last such line, outside fenced code, in what the agent said, is the session's title.

// NameWidth is the most a title from a title line takes, in display cells (a CJK character two).
const NameWidth = 48

var (
	nameFence = regexp.MustCompile("(?ms)^ {0,3}(```|~~~).*?(^ {0,3}(```|~~~)[^\\n]*$|\\z)")
	nameLine  = regexp.MustCompile(`(?m)^[ \t]*\[标题\][ \t]*(.*?)[ \t]*$\n?`)
	// What may wrap a title or end it, which a title does not need.
	nameQuotes = []string{"「」", "『』", "“”", "\"\"", "''", "‘’", "《》", "**", "``"}
	nameTail   = "。．.！!？?，,；;：:、…~～ "
)

// NameLine is the title the last title line outside fenced code in text gives, cleaned; "" if none.
func NameLine(text string) string {
	if !strings.Contains(text, "[标题]") {
		return ""
	}
	ms := nameLine.FindAllStringSubmatch(nameFence.ReplaceAllString(text, ""), -1)
	for i := len(ms) - 1; i >= 0; i-- {
		if t := CleanName(ms[i][1]); t != "" {
			return t
		}
	}
	return ""
}

// WithoutNameLines is text without its title lines (fenced code as it is): what is shown of it.
func WithoutNameLines(text string) string {
	if !strings.Contains(text, "[标题]") {
		return text
	}
	var b strings.Builder
	at := 0
	for _, f := range nameFence.FindAllStringIndex(text, -1) {
		b.WriteString(nameLine.ReplaceAllString(text[at:f[0]], ""))
		b.WriteString(text[f[0]:f[1]])
		at = f[1]
	}
	b.WriteString(nameLine.ReplaceAllString(text[at:], ""))
	return strings.TrimRight(b.String(), " \t\n")
}

// CleanName is s as a title line's text is taken: on one line, without the quotes around it or the
// punctuation at its end, cut to NameWidth. Also an agent's ir rename.
func CleanName(s string) string {
	s = oneLine(s)
	for changed := true; changed; {
		changed = false
		for _, q := range nameQuotes {
			open, close := string([]rune(q)[:1]), string([]rune(q)[1:])
			if len(s) > len(open)+len(close) && strings.HasPrefix(s, open) && strings.HasSuffix(s, close) {
				s, changed = strings.TrimSpace(s[len(open):len(s)-len(close)]), true
			}
		}
		if t := strings.TrimRight(s, nameTail); t != s {
			s, changed = t, true
		}
	}
	return cutWidth(s, NameWidth)
}

// cutWidth is s cut to at most w display cells, ending … where it was cut.
func cutWidth(s string, w int) string {
	if cellsOf(s) <= w {
		return s
	}
	n := 0
	for i, r := range s {
		if n += cells(r); n > w-1 {
			return strings.TrimSpace(s[:i]) + "…"
		}
	}
	return s
}

func cellsOf(s string) int {
	n := 0
	for _, r := range s {
		n += cells(r)
	}
	return n
}

func cells(r rune) int {
	if unicode.In(r, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Hangul) || (r >= 0x3000 && r <= 0x303f) || (r >= 0xff01 && r <= 0xff60) {
		return 2
	}
	return 1
}

// fileLine is a line that names a file by its path ("[附件] `path`" of what was sent, an agent's
// "[文件] `path`").
var fileLine = regexp.MustCompile("(?m)^[ \\t]*\\[(?:附件|文件|file|attachment)\\] `([^`\\n]+)`[ \\t]*$")

// pictureExt are the endings of the files a line of last words calls a picture.
var pictureExt = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".avif": true, ".bmp": true, ".heic": true, ".svg": true}

// FilesAsWords is text with each line that names a file by its path as the word for what it is,
// [图片] or [文件]: for one line of last words (the list, a notice), where a path says nothing and
// a message of a picture alone said nothing at all (kumo, 2026-11-19).
func FilesAsWords(text string) string {
	if !strings.Contains(text, "] `") {
		return text
	}
	return fileLine.ReplaceAllStringFunc(text, func(l string) string {
		m := fileLine.FindStringSubmatch(l)
		if pictureExt[strings.ToLower(filepath.Ext(m[1]))] {
			return "[图片]"
		}
		return "[文件]"
	})
}
