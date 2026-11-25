package satori

import (
	"strings"
	"testing"
	"time"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/channel"
	"github.com/kumoSleeping/iridium/internal/session"
	"github.com/kumoSleeping/iridium/internal/store"
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
	// Its turn begun: a message of its at once, of no words, that says it is at it.
	c := liveEvents(t, w, 1)[0]
	if c.Type != "message-created" || c.Message.ID != "3" || !strings.Contains(c.Message.Content, `<iridium:work steps="0" running="true"`) || c.User.ID != "agent:s1" {
		t.Fatalf("created: %+v %+v", c, c.Message)
	}
	// Its first words are that message's.
	n(session.NoticeWriting, "I will ", "")
	c = liveEvents(t, w, 1)[0]
	if c.Type != "message-updated" || c.Message.ID != "3" || c.Message.Content != "I will " {
		t.Fatalf("its words: %+v %+v", c, c.Message)
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
	evs := liveEvents(t, w, 2)
	if c := evs[0]; c.Type != "message-created" || c.Message.ID != "3" || !strings.HasPrefix(c.Message.Content, "<iridium:work") || !strings.Contains(c.Message.Content, "running") {
		t.Fatalf("its turn begun: %+v %+v", c, c.Message)
	}
	if c := evs[1]; c.Type != "message-updated" || c.Message.ID != "3" || !strings.Contains(c.Message.Content, `steps="1"`) || !strings.Contains(c.Message.Content, `tool="Bash"`) {
		t.Fatalf("work first: %+v %+v", c, c.Message)
	}
	n(session.NoticeWriting, "Done.", "")
	evs = liveEvents(t, w, 2)
	// The work of the wordless one is done, then the words are a new message.
	if evs[0].Type != "message-updated" || evs[0].Message.ID != "3" || strings.Contains(evs[0].Message.Content, "running") {
		t.Fatalf("work done: %+v %+v", evs[0], evs[0].Message)
	}
	if evs[1].Type != "message-created" || evs[1].Message.ID != "4" || evs[1].Message.Content != "Done." {
		t.Fatalf("words: %+v %+v", evs[1], evs[1].Message)
	}
}

// A turn that says and does nothing: the message made as it began is taken away again.
func TestLiveNothing(t *testing.T) {
	r := newRig(t)
	r.f.addSession("s1", 2)
	w := r.dial(nil)
	w.send(OpIdentify, Identify{Token: "ir_good", Live: true})
	w.want(OpReady, nil)
	r.s.Notice(session.Notice{Session: "s1", Kind: session.NoticeTurnStart})
	r.s.Notice(session.Notice{Session: "s1", Kind: session.NoticeTurnEnd})
	evs := liveEvents(t, w, 2)
	if evs[0].Type != "message-created" || evs[1].Type != "message-deleted" || evs[1].Message.ID != evs[0].Message.ID {
		t.Fatalf("%+v %+v", evs[0], evs[1])
	}
	var l List[Message]
	if status, e := r.as("u1", "message.list", map[string]any{"channel_id": "s1"}, &l); status != 200 || len(l.Data) != 2 {
		t.Fatalf("listed: %d %+v %+v", status, e, l.Data)
	}
}

// A tool call heard when st.from was never initialized (e.g., after a restart mid-turn, or after
// rest) must not record from="0" on an existing transcript.
func TestLiveStepWithoutTurnStartSetsFrom(t *testing.T) {
	r := newRig(t)
	r.f.addSession("s1", 5)
	r.f.mu.Lock()
	r.f.sessions["s1"].End = 50
	r.f.mu.Unlock()
	w := r.dial(nil)
	w.send(OpIdentify, Identify{Token: "ir_good", Live: true})
	w.want(OpReady, nil)
	r.s.Notice(session.Notice{Session: "s1", Kind: session.NoticeTool, Tool: "Bash"})
	ev := liveEvents(t, w, 1)[0]
	if ev.Type != "message-created" || strings.Contains(ev.Message.Content, `from="0"`) || !strings.Contains(ev.Message.Content, `from="50"`) {
		t.Fatalf("unexpected work from: %+v %+v", ev, ev.Message)
	}
}

// Mid-turn steer acceptance (NoticeUserRecorded) must be the exact boundary that settles the prior
// work carrier (capped at Before) and opens a fresh work message starting at After; tools before
// NoticeUserRecorded stay on the old carrier even if a user message already appeared in the channel.
func TestLiveUserRecordedSplitsCarrierAndBoundsWork(t *testing.T) {
	r := newRig(t)
	r.f.addSession("s1", 2)
	r.f.mu.Lock()
	r.f.sessions["s1"].End = 100
	r.f.mu.Unlock()
	w := r.dial(nil)
	w.send(OpIdentify, Identify{Token: "ir_good", Live: true})
	w.want(OpReady, nil)

	r.s.Notice(session.Notice{Session: "s1", Kind: session.NoticeTurnStart, From: "app1"})
	_ = liveEvents(t, w, 1) // pre #3
	r.s.Notice(session.Notice{Session: "s1", Kind: session.NoticeWriting, Text: "Working on it."})
	_ = liveEvents(t, w, 1) // #3 with words
	r.s.Notice(session.Notice{Session: "s1", Kind: session.NoticeMessage, Text: "Working on it."})
	_ = liveEvents(t, w, 1) // #3 settled text
	r.s.Notice(session.Notice{Session: "s1", Kind: session.NoticeTool, Tool: "Read"})
	// NoticeTool flushes "progress" on #3 first, then emits the step update with steps="1".
	var ev1 Event
	for range 4 {
		ev1 = liveEvents(t, w, 1)[0]
		if strings.Contains(ev1.Message.Content, `steps="1"`) {
			break
		}
	}
	if ev1.Type != "message-updated" || ev1.Message.ID != "3" || !strings.Contains(ev1.Message.Content, `steps="1"`) {
		t.Fatalf("step 1: %+v %+v", ev1, ev1.Message)
	}

	// User posts a steer in the channel BEFORE the agent accepts it: another tool call must still
	// stay on carrier #3 (honest: not falsely split before NoticeUserRecorded).
	if _, _, err := r.s.log.Say(channel.Message{ChannelMessage: store.ChannelMessage{Channel: "s1", Author: "u1", Kind: channel.KindUser, Text: "status?"}}); err != nil {
		t.Fatal(err)
	}
	r.s.Notice(session.Notice{Session: "s1", Kind: session.NoticeTool, Tool: "Bash"})
	ev2 := liveEvents(t, w, 1)[0]
	if ev2.Type != "message-updated" || ev2.Message.ID != "3" || !strings.Contains(ev2.Message.Content, `steps="2"`) {
		t.Fatalf("step before acceptance falsely split: %+v %+v", ev2, ev2.Message)
	}

	// Now the agent genuinely records the user message in its transcript at [250, 310).
	r.s.Notice(session.Notice{Session: "s1", Kind: session.NoticeUserRecorded, Text: "in-steer", Before: 250, After: 310})
	evs := liveEvents(t, w, 2)
	// 1) Old carrier #3 settles with to="250" (strictly before user block).
	if evs[0].Type != "message-updated" || evs[0].Message.ID != "3" || strings.Contains(evs[0].Message.Content, "running") || !strings.Contains(evs[0].Message.Content, `to="250"`) {
		t.Fatalf("old carrier settle: %+v %+v", evs[0], evs[0].Message)
	}
	// 2) Fresh pre-message created AFTER the user's message with from="310".
	newID := evs[1].Message.ID
	if evs[1].Type != "message-created" || newID == "3" || !strings.Contains(evs[1].Message.Content, `running="true"`) || !strings.Contains(evs[1].Message.Content, `from="310"`) {
		t.Fatalf("new pre after acceptance: %+v %+v", evs[1], evs[1].Message)
	}

	// Subsequent tool call attaches to the new carrier below the user's message.
	r.s.Notice(session.Notice{Session: "s1", Kind: session.NoticeTool, Tool: "Edit"})
	ev3 := liveEvents(t, w, 1)[0]
	if ev3.Type != "message-updated" || ev3.Message.ID != newID || !strings.Contains(ev3.Message.Content, `steps="1"`) || !strings.Contains(ev3.Message.Content, `from="310"`) {
		t.Fatalf("tool on new carrier: %+v %+v", ev3, ev3.Message)
	}
}
