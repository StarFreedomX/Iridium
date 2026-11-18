package cli

import (
	"io"
	"strings"
	"testing"
	"time"
)

// While a turn runs, a message (ir api message.create) joins it, a person's as an agent's:
// nothing waits in the queue for the turn's end (kumo, 2026-11-19), and --wait prints the reply
// to it.
func TestSendJoinsTurn(t *testing.T) {
	_, work := rig(t)
	r := ir("api", "channel.create", "_data.agent=claude", "_data.cwd="+work, "_data.text=one WAIT")
	if r.code != 0 {
		t.Fatalf("new: %+v", r)
	}
	sid := strings.TrimSpace(r.out)
	send := func(text string, more ...string) result {
		return ir(append([]string{"api", "message.create", "channel_id=" + sid, "_data.text=" + text}, more...)...)
	}
	queue := func() []string {
		t.Helper()
		var st struct {
			Queue []struct{ Text string } `json:"queue"`
		}
		e := newEnv(io.Discard, io.Discard)
		full, err := e.resolve(sid)
		if err == nil {
			err = e.do("GET", "/v1/internal/sessions/"+full, nil, &st)
		}
		if err != nil {
			t.Fatal(err)
		}
		var texts []string
		for _, q := range st.Queue {
			texts = append(texts, q.Text)
		}
		return texts
	}
	if r := send("two", "--wait"); r.code != 0 || r.out != "ok: two\n" {
		t.Errorf("joined: %+v", r)
	}
	// A person's, from a shell that is no agent's.
	send("three WAIT")
	time.Sleep(100 * time.Millisecond)
	for _, k := range []string{"IRIDIUM_SESSION", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "CODEX_SESSION_ID", "PI_SESSION_ID"} {
		t.Setenv(k, "")
	}
	if r := send("four"); r.code != 0 || strings.Contains(r.out, "true") {
		t.Errorf("a person's: %+v", r)
	}
	if q := queue(); len(q) != 0 {
		t.Errorf("a person's message waits: %q", q)
	}
	if r := ir("api", "GET", "internal/sessions/"+sid, "--wait"); r.code != 0 || r.out != "ok: four\n" {
		t.Errorf("the turn it joined: %+v", r)
	}
	if r := ir("api", "message.list", "channel_id="+sid); !strings.Contains(r.out, "ok: three WAIT") {
		t.Errorf("message.list: %+v", r)
	}
	// An agent's.
	send("seven WAIT")
	time.Sleep(100 * time.Millisecond)
	t.Setenv("IRIDIUM_SESSION", "caller-session")
	if r := send("eight"); r.code != 0 {
		t.Errorf("an agent's: %+v", r)
	}
	if q := queue(); len(q) != 0 {
		t.Errorf("an agent's message waits: %q", q)
	}
}
