package satori

import (
	"strings"
	"testing"

	"github.com/kumoSleeping/iridium/internal/api"
)

// A channel's message given to an agent is Satori's forward and the relay's plain attributes:
// each message's words as given, nothing of Iridium's standing words.
func TestRelayContent(t *testing.T) {
	b := api.Block{At: "3.0", Kind: api.BlockKindUser, Text: "#7: hi\n\n<channel-context>\nYou are a…\n</channel-context>"}
	r := Relay{Channel: "ch", Name: `the "odd" one`, Seq: 7, Msgs: []RelayMsg{
		{ID: "2-4", User: User{Name: "kumo"}, Text: "fix it (answered by a)", Turn: true},
		{ID: "5", User: User{ID: "u1", Name: "Ann"}, Text: "a < b […3 more characters: ir api message.get channel_id=self message_id=5]"},
		{ID: "7", User: User{ID: "local", Name: "Iridium"}, Text: "hi"},
	}}
	got := relayContent(b, r, func(s string) string { return s })
	want := `<iridium:relay channel="ch" name="the &quot;odd&quot; one" seq="7"/><message forward>` +
		`<message id="2-4"><author name="kumo"/>fix it (answered by a)<iridium:turn/></message>` +
		`<message id="5"><author id="u1" name="Ann"/>a &lt; b […3 more characters: ir api message.get channel_id=self message_id=5]</message>` +
		`<message id="7"><author id="local" name="Iridium"/>hi</message></message>`
	if !strings.HasSuffix(got, want) {
		t.Errorf("got:\n%s\nwant suffix:\n%s", got, want)
	}
	if strings.Contains(got, "You are") || strings.Contains(got, "channel-context") || strings.Contains(got, " full") {
		t.Errorf("the internal words in the standard content: %s", got)
	}
}
