package satori

import (
	"strings"
	"testing"
	"time"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/session"
)

// liveEvents reads events from w till one is of typ and passes ok, and returns all read.
func liveEvents(t *testing.T, w *ws, n int) []Event {
	t.Helper()
	var out []Event
	for len(out) < n {
		var ev Event
		w.want(OpEvent, &ev)
		if ev.Login != nil && ev.Login.User != nil && ev.Login.User.ID != "u1" {
			continue // one login's is enough
		}
		out = append(out, ev)
	}
	return out
}

// A connection that takes messages live: the agent's message is created as it begins to write
// it, updated as it grows and when it is whole; its calls after are that message's work; the
// turn's end marks it the reply and the work done. Its number never changes, and no event of it
// is a second message-created. A connection that does not is told as before.
func TestLiveMessage(t *testing.T) {
	r := newRig(t)
	r.f.addSession("s1", 2)
	old := r.dial(nil)
	old.send(OpIdentify, Identify{Token: "ir_good"})
	old.want(OpReady, nil)
	w := r.dial(nil)
	w.send(OpIdentify, Identify{Token: "ir_good", Live: true})
	w.want(OpReady, nil)

	n := func(k session.NoticeKind, text, tool string) {
		r.s.Notice(session.Notice{Session: "s1", Kind: k, Text: text, Tool: tool})
	}
	r.s.Notice(session.Notice{Session: "s1", Kind: session.NoticeTurnStart, From: "app1"})
	n(session.NoticeWriting, "I will ", "")
	c := liveEvents(t, w, 1)[0]
	if c.Type != "message-created" || c.Message.ID != "3" || c.Message.Content != "I will " || c.User.ID != "agent:s1" {
		t.Fatalf("created: %+v %+v", c, c.Message)
	}
	time.Sleep(writeEvery + 20*time.Millisecond)
	n(session.NoticeWriting, "look.", "")
	u := liveEvents(t, w, 1)[0]
	if u.Type != "message-updated" || u.Message.ID != "3" || u.Message.Content != "I will look." {
		t.Fatalf("updated: %+v %+v", u, u.Message)
	}
	r.f.addBlock("s1", api.Block{Kind: api.BlockKindAssistant, Text: "I will look."})
	n(session.NoticeMessage, "I will look.", "")
	n(session.NoticeTool, "", "Bash")
	n(session.NoticeTool, "", "Read")
	n(session.NoticeTurnEnd, "", "")
	// Whole, found in its record, each call, then the work done: all updates of the one message.
	var last Event
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		ev := liveEvents(t, w, 1)[0]
		if ev.Type != "message-updated" || ev.Message.ID != "3" {
			t.Fatalf("a second message, or not an update: %+v %+v", ev, ev.Message)
		}
		last = ev
		if strings.Contains(ev.Message.Content, `steps="2"`) && !strings.Contains(ev.Message.Content, "running") {
			break
		}
	}
	if !strings.HasPrefix(last.Message.Content, "I will look.<iridium:work") || !strings.Contains(last.Message.Content, `tool="Read"`) {
		t.Fatalf("last: %q", last.Message.Content)
	}
	// The one that takes messages whole: one message-created, as before, no work in it.
	var ev Event
	old.want(OpEvent, &ev)
	if ev.Type != "message-created" || ev.Message.ID != "3" || ev.XData.Kind != "progress" || ev.Message.Content != "I will look." {
		t.Fatalf("whole: %+v %+v", ev, ev.Message)
	}
	// Listed: the one message, its work with it.
	var l List[Message]
	if status, e := r.as("u1", "message.list", map[string]any{"channel_id": "s1"}, &l); status != 200 {
		t.Fatal(status, e)
	}
	got := l.Data[len(l.Data)-1]
	if got.ID != "3" || !strings.Contains(got.Content, `<iridium:work steps="2"`) {
		t.Fatalf("listed: %+v", got)
	}
}

// An agent that calls a tool before it says anything: a message of no words carries the work;
// what it says then is the next message, and the work after that is the new one's.
func TestLiveWorkFirst(t *testing.T) {
	r := newRig(t)
	r.f.addSession("s1", 2)
	w := r.dial(nil)
	w.send(OpIdentify, Identify{Token: "ir_good", Live: true})
	w.want(OpReady, nil)
	n := func(k session.NoticeKind, text, tool string) {
		r.s.Notice(session.Notice{Session: "s1", Kind: k, Text: text, Tool: tool})
	}
	n(session.NoticeTurnStart, "", "")
	n(session.NoticeTool, "", "Bash")
	c := liveEvents(t, w, 1)[0]
	if c.Type != "message-created" || c.Message.ID != "3" || !strings.HasPrefix(c.Message.Content, "<iridium:work") || !strings.Contains(c.Message.Content, "running") {
		t.Fatalf("work first: %+v %+v", c, c.Message)
	}
	n(session.NoticeWriting, "Done.", "")
	evs := liveEvents(t, w, 2)
	// The work of the wordless one is done, then the words are a new message.
	if evs[0].Type != "message-updated" || evs[0].Message.ID != "3" || strings.Contains(evs[0].Message.Content, "running") {
		t.Fatalf("work done: %+v %+v", evs[0], evs[0].Message)
	}
	if evs[1].Type != "message-created" || evs[1].Message.ID != "4" || evs[1].Message.Content != "Done." {
		t.Fatalf("words: %+v %+v", evs[1], evs[1].Message)
	}
}
