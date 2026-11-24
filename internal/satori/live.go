package satori

import (
	"strconv"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/channel"
	"github.com/kumoSleeping/iridium/internal/session"
)

// Messages as they are written (docs/next/ui.md): what an agent says in its turn is a message of
// its channel from the moment it begins to write it (message-created, _data.writing), changed as
// it grows (message-updated, the whole of it each time) and once more when it is whole. What it
// does after is that message's work (<iridium:work>), changed with each call; an agent that calls
// a tool before it said anything in its turn has a message of no words that carries it. A page
// draws nothing of an agent that is no message. These go to the connections that asked for them
// (Identify.Live); the others are told each message once, whole, as before.

// noticeWritten: the service's own, to itself: what an agent wrote since it was last told is
// told now (the pieces come faster than they are worth telling).
const noticeWritten session.NoticeKind = "satori:written"

// writeEvery is how often at most a message being written is told again.
const writeEvery = 120 * time.Millisecond

// saying is what an agent is at in its turn.
type saying struct {
	// seq: the message being written, 0 none; text, what there is of it; told, when it was
	// last told; due, a noticeWritten is on its way.
	seq  int64
	text strings.Builder
	told time.Time
	due  bool
	// carrier: the message of this turn that carries the work now (the last it said, or one of
	// no words), 0 none yet.
	carrier int64
	// last: the words of the last message it said in this turn.
	last string
	// whole: the message being written was read in from the agent's record, whole, before it
	// was heard: nothing more of it is told till it is said.
	whole bool
}

func (s *Service) sayingOf(id string) *saying {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.live[id]
	if st == nil {
		st = &saying{}
		s.live[id] = st
	}
	return st
}

// workElement is the work a message carries, as an element after its words: running, steps,
// tool (the last call's name), ms, at, and from, to: the lines of the agent's record it spans.
func workElement(w *channel.Work) string {
	if w == nil || (w.Steps == 0 && !w.Running) {
		return ""
	}
	kv := []string{"steps", strconv.Itoa(w.Steps)}
	if w.Running {
		kv = append(kv, "running", "true")
	}
	if w.Tool != "" {
		kv = append(kv, "tool", w.Tool)
	}
	num := func(k string, n int64) {
		if n != 0 {
			kv = append(kv, k, strconv.FormatInt(n, 10))
		}
	}
	num("at", w.At)
	num("ms", w.Ms)
	kv = append(kv, "from", strconv.FormatInt(w.From, 10))
	num("to", w.To)
	return String([]Element{Tag(Adapter+":work", kv)})
}

// tellLive tells the connections that take messages live of m: typ message-created or
// message-updated; passing: it will be told again soon.
func (s *Service) tellLive(typ string, m channel.Message, passing bool, origin string) {
	st, err := s.b.Session(m.Channel)
	if err != nil {
		return
	}
	msg := Message{ID: strconv.FormatInt(m.Seq, 10), Content: s.logContent(m), User: s.authorOf(m, nil), CreatedAt: m.At, Data: logData(m)}
	msg.Content += activityElement(m.D.Activity, false) + workElement(m.D.Work)
	if typ == "message-updated" {
		msg.UpdatedAt = time.Now().UnixMilli()
	}
	s.emitTo(toLive, passing, st.Session, fileOwner(m), Event{Type: typ, Message: &msg, User: msg.User}, s.logFiles(m), logData(m).Kind, origin)
}

// endOf is how far session id's record goes now: where what its agent does next begins.
func (s *Service) endOf(id string) int64 {
	if st, err := s.b.Session(id); err == nil {
		return st.End
	}
	return 0
}

// settle: the work message seq of id's channel carries is done.
func (s *Service) settle(id string, seq int64, origin string) {
	if seq == 0 {
		return
	}
	cur, ok := s.log.Get(id, seq)
	if !ok || cur.D.Work == nil || !cur.D.Work.Running {
		return
	}
	end := s.endOf(id)
	if m, ok := s.log.SetWork(id, seq, func(w *channel.Work) {
		w.Running = false
		if w.At != 0 {
			w.Ms = max(time.Now().UnixMilli()-w.At, 1)
		}
		w.To = end
	}); ok {
		s.tellLive("message-updated", m, false, origin)
	}
}

// writing: session id's agent wrote piece of a message.
func (s *Service) writing(id, piece, origin string) {
	if s.log == nil || piece == "" || !s.log.Listening(id) {
		return
	}
	st := s.sayingOf(id)
	st.text.WriteString(piece)
	if st.seq == 0 {
		if strings.TrimSpace(st.text.String()) == "" {
			return // nothing to show yet
		}
		m, adopted, err := s.log.Begin(id, st.text.String(), true, s.heardOf(id))
		if err != nil || m.Seq == 0 {
			s.logf("satori: channel of %s: %v", id, err)
			st.text.Reset()
			return
		}
		// It speaks again: what it did since it last spoke is done.
		s.settle(id, st.carrier, origin)
		st.seq, st.carrier, st.told, st.whole = m.Seq, m.Seq, time.Now(), adopted
		s.tellLive("message-created", m, false, origin)
		return
	}
	if st.whole {
		return
	}
	if time.Since(st.told) >= writeEvery {
		s.written(id, origin)
		return
	}
	if !st.due {
		st.due = true
		time.AfterFunc(writeEvery, func() { s.Notice(session.Notice{Session: id, Kind: noticeWritten}) })
	}
}

// written tells what there is now of the message id's agent is writing.
func (s *Service) written(id, origin string) {
	st := s.sayingOf(id)
	st.due = false
	if st.seq == 0 {
		return
	}
	m, ok := s.log.Get(id, st.seq)
	if !ok {
		return
	}
	m.Text, m.D.Writing = st.text.String(), true
	st.told = time.Now()
	s.tellLive("message-updated", m, true, origin)
}

// say: id's agent, heard live, said text, whole: the message it was writing is that, or (an
// agent that says its words whole) a message is made of it now. It is held as hear holds one:
// what the agent does next tells whether it was its reply; and what else its record has that
// the channel has not (words typed in its terminal) is told.
func (s *Service) say(id, text, origin string) {
	st := s.sayingOf(id)
	var m channel.Message
	if st.seq != 0 && st.whole {
		// Taken for the one its record had first: it is, if its words are these.
		if got, ok := s.log.Get(id, st.seq); !ok || !channel.Same(got.Text, text) {
			st.seq, st.whole = 0, false
		}
	}
	switch {
	case st.seq != 0 && st.whole:
		m, _ = s.log.Get(id, st.seq)
	case st.seq != 0:
		got, ok := s.log.Wrote(id, st.seq, text)
		if !ok {
			st.seq = 0
			st.text.Reset()
			return
		}
		m = got
		s.tellLive("message-updated", m, false, origin)
	default:
		if strings.TrimSpace(text) == "" {
			return
		}
		got, _, err := s.log.Begin(id, text, false, s.heardOf(id))
		if err != nil || got.Seq == 0 {
			s.logf("satori: channel of %s: %v", id, err)
			return
		}
		m = got
		s.settle(id, st.carrier, origin)
		s.tellLive("message-created", m, false, origin)
	}
	st.seq, st.carrier, st.last, st.whole = 0, m.Seq, text, false
	st.text.Reset()
	s.flush(id, "progress", origin, 0)
	others, err := s.log.Sync(id)
	if err != nil {
		s.logf("satori: channel of %s: %v", id, err)
	}
	for _, o := range others {
		kind := "progress"
		if o.Kind == channel.KindUser {
			kind = "user"
		}
		s.tell(o, kind, origin, 0)
	}
	if cur, ok := s.log.Get(id, m.Seq); ok {
		m = cur // found in its record meanwhile
	}
	s.mu.Lock()
	s.held[id] = m
	s.heard[id] = m.Seq
	s.mu.Unlock()
}

// heardLive: what id's agent just said is held (hear): one not written before the eyes of
// those who take messages live (an agent that says its words whole) is told them now, and it
// carries the work from here.
func (s *Service) heardLive(id, origin string) {
	s.mu.Lock()
	held, ok := s.held[id]
	s.mu.Unlock()
	if !ok || held.Seq == 0 {
		return
	}
	st := s.sayingOf(id)
	if st.carrier == held.Seq {
		return
	}
	s.settle(id, st.carrier, origin)
	st.carrier = held.Seq
	s.tellLive("message-created", held, false, origin)
}

// step: id's agent calls tool.
func (s *Service) step(id, tool, origin string) {
	if s.log == nil {
		return
	}
	st := s.sayingOf(id)
	now := time.Now().UnixMilli()
	// Something was said in its channel after the message that carries its work (words put into
	// its turn, another's): what it does from here is after that, on a message of its own
	// (kumo, 2026-11-24: the steps under words sent into a turn counted those from before them).
	if st.carrier != 0 && st.seq == 0 && s.log.End(id) > st.carrier {
		s.settle(id, st.carrier, origin)
		st.carrier = 0
	}
	if st.carrier == 0 {
		m, err := s.log.BeginWork(id, channel.Work{Steps: 1, Tool: tool, Running: true, At: now, From: s.endOf(id)})
		if err != nil || m.Seq == 0 {
			s.logf("satori: channel of %s: %v", id, err)
			return
		}
		st.carrier = m.Seq
		s.tellLive("message-created", m, false, origin)
		return
	}
	end := int64(-1)
	m, ok := s.log.SetWork(id, st.carrier, func(w *channel.Work) {
		if w.Steps == 0 {
			if end < 0 {
				end = s.endOf(id)
			}
			w.At, w.From = now, end
		}
		w.Steps++
		w.Tool, w.Running, w.Ms, w.To = tool, true, 0, 0
	})
	if ok {
		s.tellLive("message-updated", m, true, origin)
	}
}

// rest: id's agent is at nothing (its turn ended, was cut short, or another begins): what it
// was writing is as far as it got, its work done.
func (s *Service) rest(id, origin string) {
	if s.log == nil {
		return
	}
	s.mu.Lock()
	st := s.live[id]
	delete(s.live, id)
	s.mu.Unlock()
	if st == nil {
		return
	}
	if st.seq != 0 && !st.whole {
		if m, ok := s.log.Wrote(id, st.seq, st.text.String()); ok {
			s.tellLive("message-updated", m, false, origin)
		}
	}
	s.settle(id, st.carrier, origin)
}

// heardOf is the number of the last message heard from id's agent.
func (s *Service) heardOf(id string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.heard[id]
}
