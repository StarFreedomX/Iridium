package session

import (
	"encoding/json"

	"github.com/kumoSleeping/iridium/internal/ctx/assemble"
	"github.com/kumoSleeping/iridium/internal/store"
)

// given keeps what session's agent is given, whole (its injections, docs/channels.md "可追溯";
// kumo, 2026-11-16: the record is to show what it got, every bit): the system prompt as it
// starts, each line written to it. One a channel kept already for this input (its parts, its
// message) gets the text as it was written, its sender's tag too.
func (m *Manager) given(session, input string, line assemble.Injection) {
	st := m.o.Store
	rec := line.Record()
	if input != "" {
		if in, ok := st.InjectionOf(session, input); ok {
			var r assemble.Record
			if json.Unmarshal([]byte(in.Record), &r) == nil {
				r.Text = rec.Text
				if b, err := json.Marshal(r); err == nil {
					if err := st.SetInjectionRecord(in.ID, string(b)); err != nil {
						m.o.Logf("session %s: keeping what it was given: %v", session, err)
					}
				}
				return
			}
		}
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return
	}
	if err := st.AddInjection(store.Injection{Session: session, Input: input, Record: string(b)}); err != nil {
		m.o.Logf("session %s: keeping what it was given: %v", session, err)
	}
}
