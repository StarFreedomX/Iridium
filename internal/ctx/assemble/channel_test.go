package assemble

import (
	"testing"

	"github.com/kumoSleeping/iridium/internal/activity"
	"github.com/kumoSleeping/iridium/internal/ctx/strategy"
)

func TestChannelTurn(t *testing.T) {
	var p strategy.Plan
	p.Skipped.From, p.Skipped.To, p.Skipped.Count = 1, 4, 4
	p.Turns = []strategy.Turn{{From: 5, To: 8, Who: "kumo", Head: "fix the build", Answered: []string{"claude"}}}
	p.Full = []strategy.Full{{Msg: strategy.Msg{Seq: 9, Who: "claude", Text: "done", At: 3600_000}}, {Msg: strategy.Msg{Seq: 10, Who: "kumo", Text: "long", At: 3660_000}, Left: 7}}
	did := activity.Activity{Bash: 7, Failed: 1, Cmds: map[string]int{"go": 4, "git": 3}, Read: 2, Search: 1, Files: []activity.File{{Path: "/w/a.go", Add: 120, Del: 14}, {Path: "/w/b.go", Add: 3}}}
	in, err := ChannelTurn(Channel{You: "codex", Agents: []ChannelAgent{{"claude", "Claude Opus"}, {"codex", ""}}, Plan: p, Pull: true,
		Did: map[int64]activity.Activity{9: did}, Work: []Work{{"claude", did}, {"pi", activity.Activity{}}}}, 11, "@codex look", "in1")
	if err != nil {
		t.Fatal(err)
	}
	want := `#11: @codex look

<channel-context>
You are codex in a channel shared with people and other agents. Its agents: claude (Claude Opus), codex. Only what you say reaches the channel: your thinking and tool calls stay yours, and you do not see theirs. To call another agent, write @ and its name in what you say; without that no agent is called.
#1–#4: 4 earlier messages, not shown.
Listed by turn (who asked, their first words, who answered):
#5–#8 kumo: fix the build (answered by claude)
In full, what was said since you last read the channel:
#9 [claude · 01-01 01:00 · bash 7 (go 4, git 3), 1 failed · 2 files +123 −14 · read 2 · web 1]: done
#10 [kumo · 01-01 01:01]: long […7 more characters: ir api message.get channel_id=self message_id=10]
Work since you last read the channel (tool calls counted; files as changed by editing tools, not by shell commands):
claude: bash 7 (go 4, git 3), 1 failed · 2 files +123 −14 · read 2 · web 1 — /w/a.go, /w/b.go
More of the channel: ir api message.list channel_id=self [next=<number> limit=<n>]; one message whole: ir api message.get channel_id=self message_id=<number>.
</channel-context>`
	if got := in.String(); got != want {
		t.Errorf("got:\n%s\nwant:\n%s", got, want)
	}
	if in.Kind() != KindTurnPrefix {
		t.Error(in.Kind())
	}
	// Each part says where it is from; the words of others are cited, not kept.
	var cited int
	for _, part := range in.Record().Parts {
		if part.Source == SourceInput {
			cited++
			if len(part.Refs) == 0 || part.Values != nil {
				t.Errorf("words not cited: %+v", part)
			}
		}
	}
	if cited != 3 {
		t.Errorf("%d parts of words", cited)
	}
	// Nothing unseen: who is there, nothing else.
	in, _ = ChannelTurn(Channel{You: "a", Agents: []ChannelAgent{{"a", ""}}}, 1, "hi", "")
	if got := in.String(); got != "#1: hi\n\n<channel-context>\nYou are a in a channel shared with people and other agents. Its agents: a. Only what you say reaches the channel: your thinking and tool calls stay yours, and you do not see theirs. To call another agent, write @ and its name in what you say; without that no agent is called.\n</channel-context>" {
		t.Errorf("bare: %q", got)
	}
}
