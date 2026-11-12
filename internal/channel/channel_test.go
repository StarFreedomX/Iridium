package channel

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/store"
)

// records are sessions with a record of one block a line, offsets 10 apart, read 3 at a time.
type records struct {
	mu     sync.Mutex
	blocks map[string][]api.Block
}

func (r *records) add(id string, b api.Block) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b.At = fmt.Sprintf("%d.0", len(r.blocks[id])*10)
	r.blocks[id] = append(r.blocks[id], b)
}

func (r *records) State(id string) (*api.SessionState, error) {
	if _, ok := r.blocks[id]; !ok {
		return nil, errors.New("no such session")
	}
	return &api.SessionState{Session: api.Session{ID: id}}, nil
}

func (r *records) Messages(id string, before, after int64) (api.MessagePage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	bs := r.blocks[id]
	lo := min(int(max(after, 0)+9)/10, len(bs))
	hi := min(lo+3, len(bs))
	return api.MessagePage{Blocks: append([]api.Block{}, bs[lo:hi]...), Start: after, End: int64(hi * 10)}, nil
}

func (r *records) Full(id, at string) (string, error) { return "", errors.New("gone") }

func rig(t *testing.T) (*Service, *records, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "iridium.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	r := &records{blocks: map[string][]api.Block{}}
	return New(st, r, t.Logf), r, st
}

func texts(ms []Message) string {
	out := ""
	for _, m := range ms {
		out += fmt.Sprintf("%d:%s:%s ", m.Seq, m.Kind, m.Text)
	}
	return out
}

// A session's record is read into its channel once, in order: what people and the agent said,
// not its thinking or its tools; what comes later is added after, nothing twice.
func TestSync(t *testing.T) {
	s, r, _ := rig(t)
	r.add("s1", api.Block{Kind: api.BlockKindUser, Text: "hi", ID: "in1", From: "web", FromTerminal: "t1"})
	r.add("s1", api.Block{Kind: api.BlockKindThinking, Text: "hm"})
	r.add("s1", api.Block{Kind: api.BlockKindAssistant, Text: "hello"})
	r.add("s1", api.Block{Kind: api.BlockKindTool, Name: "Bash"})
	r.add("s1", api.Block{Kind: api.BlockKindAssistant, Text: "done"})
	r.add("s1", api.Block{Kind: api.BlockKindUser, Text: "typed in the terminal"})
	ms, err := s.List("s1", 0, -1, 0)
	if err != nil || texts(ms) != "1:user:hi 2:said:hello 3:said:done 4:user:typed in the terminal " {
		t.Fatalf("read in: %v %s", err, texts(ms))
	}
	if ms[0].Author != "t1" || ms[0].Name != "web" || ms[1].Author != "agent:s1" || ms[1].D.Block != "20.0" || ms[3].Author != HostTerminal {
		t.Errorf("who: %+v", ms)
	}
	// Again: nothing new. More in the record: after what is there.
	if added, err := s.Sync("s1"); err != nil || len(added) != 0 {
		t.Errorf("again: %v %s", err, texts(added))
	}
	r.add("s1", api.Block{Kind: api.BlockKindAssistant, Text: "more"})
	if added, err := s.Sync("s1"); err != nil || texts(added) != "5:said:more " {
		t.Errorf("more: %v %s", err, texts(added))
	}
	// Pages: before a number, after one.
	if ms, _ := s.List("s1", 3, -1, 0); texts(ms) != "1:user:hi 2:said:hello " {
		t.Errorf("before 3: %s", texts(ms))
	}
	if ms, _ := s.List("s1", 0, 3, 1); texts(ms) != "4:user:typed in the terminal " {
		t.Errorf("after 3: %s", texts(ms))
	}
}

// What a person sends is said as it is sent, and not again when the agent's record has it; what
// the agent says before its record has it is said from its words, and is that block once found.
func TestSayAndHeard(t *testing.T) {
	s, r, _ := rig(t)
	r.add("s1", api.Block{Kind: api.BlockKindAssistant, Text: "old", Time: 1})
	m, isNew, err := s.Say(Message{ChannelMessage: store.ChannelMessage{Channel: "s1", Author: "u1", Kind: KindUser, Text: "q", Ref: "in1"}})
	if err != nil || !isNew || m.Seq != 2 {
		t.Fatalf("said: %v %v %+v", err, isNew, m)
	}
	if _, isNew, _ := s.Say(Message{ChannelMessage: store.ChannelMessage{Channel: "s1", Author: "u1", Kind: KindUser, Text: "q", Ref: "in1"}}); isNew {
		t.Error("said twice")
	}
	r.add("s1", api.Block{Kind: api.BlockKindUser, Text: "q", ID: "in1", From: "web", FromTerminal: "t1"})
	// The agent speaks; its record lags.
	others, said, err := s.Heard("s1", "answer", 0, 0)
	if err != nil || len(others) != 0 || said.Seq != 3 || said.Ref != "" {
		t.Fatalf("heard live: %v %s %+v", err, texts(others), said)
	}
	r.add("s1", api.Block{Kind: api.BlockKindAssistant, Text: "answer", Files: []api.FileRef{{Ref: "f1"}}})
	r.add("s1", api.Block{Kind: api.BlockKindAssistant, Text: "next"})
	others, said, err = s.Heard("s1", "next", 3, 0)
	if err != nil || len(others) != 0 || said.Seq != 4 || said.Ref != "b:s1:30.0" {
		t.Fatalf("heard from the record: %v %s %+v", err, texts(others), said)
	}
	got, _ := s.Get("s1", 3)
	if got.Ref != "b:s1:20.0" || len(got.D.Files) != 1 {
		t.Errorf("found in the record: %+v", got)
	}
	if fin := s.Final(said); !fin.D.Final {
		t.Error("not final")
	}
	if ms, _ := s.List("s1", 0, -1, 0); texts(ms) != "1:said:old 2:user:q 3:said:answer 4:said:next " {
		t.Errorf("all: %s", texts(ms))
	}
	// Taken back: gone from the list, its number not used again; sent again, a new message.
	s.Unsay("s1", 2)
	m, isNew, _ = s.Say(Message{ChannelMessage: store.ChannelMessage{Channel: "s1", Author: "u1", Kind: KindUser, Text: "q", Ref: "in1"}})
	if !isNew || m.Seq != 5 {
		t.Errorf("after taking back: %v %+v", isNew, m)
	}
}

// What an agent did between two things it said goes with what it says next; what it has done
// since it last spoke is kept till it speaks.
func TestActivity(t *testing.T) {
	s, r, _ := rig(t)
	r.add("s1", api.Block{Kind: api.BlockKindUser, Text: "go", ID: "in1", From: "web", FromTerminal: "t1"})
	r.add("s1", api.Block{Kind: api.BlockKindTool, Name: "Bash", Input: `{"command":"go test ./..."}`, Time: 1000})
	r.add("s1", api.Block{Kind: api.BlockKindTool, Name: "Edit", Input: `{"file_path":"/w/a.go","old_string":"a","new_string":"a\nb"}`})
	r.add("s1", api.Block{Kind: api.BlockKindAssistant, Text: "fixed", Time: 4000})
	r.add("s1", api.Block{Kind: api.BlockKindAssistant, Text: "and done", Time: 5000})
	r.add("s1", api.Block{Kind: api.BlockKindTool, Name: "Read", Input: `{"file_path":"/w/a.go"}`})
	ms, err := s.List("s1", 0, -1, 0)
	if err != nil || len(ms) != 3 {
		t.Fatalf("read in: %v %s", err, texts(ms))
	}
	a := ms[1].D.Activity
	if a == nil || a.Bash != 1 || a.Cmds["go"] != 1 || len(a.Files) != 1 || a.Files[0].Add != 2 || a.Files[0].Del != 1 || a.Ms != 3000 {
		t.Fatalf("what it did before speaking: %+v", a)
	}
	if ms[2].D.Activity != nil {
		t.Errorf("nothing done, yet: %+v", ms[2].D.Activity)
	}
	if d := s.Doing("s1"); d.Read != 1 || d.Bash != 0 {
		t.Errorf("doing: %+v", d)
	}
	// It speaks again: what it was doing goes with that, and nothing is left.
	r.add("s1", api.Block{Kind: api.BlockKindAssistant, Text: "read it"})
	ms, _ = s.List("s1", 0, -1, 0)
	if a := ms[3].D.Activity; a == nil || a.Read != 1 || !s.Doing("s1").Empty() {
		t.Errorf("after speaking: %+v, doing %+v", a, s.Doing("s1"))
	}
}
