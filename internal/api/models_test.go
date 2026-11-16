package api

import "testing"

// The agents' "default" entry is no row: the model it resolves to is marked; one not listed is a
// row under its real name; a state never says "default".
func TestNamedModels(t *testing.T) {
	claude := []Model{
		{Value: "default", Name: "Default (recommended)", Description: "Opus 5.5 · Most capable", Resolved: "claude-opus-5-5"},
		{Value: "opus", Name: "Opus 5.5", Resolved: "claude-opus-5-5"},
		{Value: "haiku", Name: "Haiku 5.5", Resolved: "claude-haiku-5-5"},
	}
	got := NamedModels(claude)
	if len(got) != 2 || got[0].Value != "opus" || !got[0].Default || got[1].Default {
		t.Errorf("merged into its alias: %+v", got)
	}
	if len(claude) != 3 || claude[1].Default {
		t.Errorf("the list given was changed: %+v", claude)
	}
	// Not listed: a row of its own, by the description's head, picked by the id it resolves to.
	got = NamedModels([]Model{claude[0], claude[2]})
	if len(got) != 2 || got[0].Value != "claude-opus-5-5" || got[0].Name != "Opus 5.5" || !got[0].Default {
		t.Errorf("not listed: %+v", got)
	}
	// Neither an id nor a description: it cannot be named, no row.
	got = NamedModels([]Model{{Value: "default", Name: "Default"}, claude[2]})
	if len(got) != 1 || got[0].Value != "haiku" {
		t.Errorf("not named: %+v", got)
	}
	// None called default (Codex, dsh: they mark theirs): as it is.
	codex := []Model{{Value: "a", Name: "A"}, {Value: "b", Name: "B", Default: true}}
	if got = NamedModels(codex); len(got) != 2 || !got[1].Default {
		t.Errorf("as it is: %+v", got)
	}

	s := SessionState{Pick: "default", Model: "default", Models: claude}
	NameModel(&s)
	if s.Pick != "" || s.Model != "claude-opus-5-5" || len(s.Models) != 2 {
		t.Errorf("state: pick %q model %q models %+v", s.Pick, s.Model, s.Models)
	}
	s = SessionState{Pick: "haiku", Model: "claude-haiku-5-5", Models: claude}
	NameModel(&s)
	if s.Pick != "haiku" || s.Model != "claude-haiku-5-5" {
		t.Errorf("a model set: pick %q model %q", s.Pick, s.Model)
	}
	s = SessionState{Model: "default"}
	NameModel(&s)
	if s.Model != "" {
		t.Errorf("not known: model %q", s.Model)
	}
}
