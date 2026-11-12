package strategy

import (
	"fmt"
	"strings"
	"testing"
)

func msgs(n int, size int) []Msg {
	var out []Msg
	for i := 1; i <= n; i++ {
		m := Msg{Seq: int64(i), Who: "kumo", Text: fmt.Sprintf("q%d %s", i, strings.Repeat("x", size))}
		if i%3 != 1 {
			m.Who, m.Agent = "claude", true
			if i%3 == 0 {
				m.Who = "codex"
			}
		}
		out = append(out, m)
	}
	return out
}

func TestFold(t *testing.T) {
	// Little: all in full.
	p := Fold(msgs(5, 10), Default)
	if len(p.Full) != 5 || len(p.Turns) != 0 || p.Skipped.Count != 0 || p.Full[0].Seq != 1 {
		t.Fatalf("little: %+v", p)
	}
	// Much: the latest in full, the ones before by turn, the earliest skipped; nothing lost.
	b := Budget{Bytes: 3000, Message: 100, Turns: 4, Head: 20}
	all := msgs(90, 150)
	p = Fold(all, b)
	if len(p.Full) == 0 || len(p.Full) > 20 || p.Full[len(p.Full)-1].Seq != 90 || p.Full[0].Left != 54 || len([]rune(p.Full[0].Text)) != 100 {
		t.Fatalf("full: %d %+v", len(p.Full), p.Full[0])
	}
	if len(p.Turns) != 4 || p.Turns[3].To != p.Full[0].Seq-1 || p.Skipped.From != 1 || p.Skipped.To != p.Turns[0].From-1 || p.Skipped.Count != int(p.Skipped.To) {
		t.Fatalf("turns: %+v skipped %+v", p.Turns, p.Skipped)
	}
	if tn := p.Turns[0]; tn.Who != "kumo" || !strings.HasSuffix(tn.Head, "…") || len(tn.Answered) != 2 {
		t.Errorf("a turn: %+v", tn)
	}
	// One message over the budget still goes, cut.
	p = Fold([]Msg{{Seq: 7, Who: "a", Text: strings.Repeat("y", 9000)}}, Budget{Bytes: 300, Message: 50, Turns: 1, Head: 10})
	if len(p.Full) != 1 || p.Full[0].Left != 8950 {
		t.Errorf("one big: %+v", p)
	}
	if p := Fold(nil, Default); len(p.Full)+len(p.Turns) != 0 {
		t.Errorf("none: %+v", p)
	}
}
