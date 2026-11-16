package api

import (
	"cmp"
	"slices"
	"strings"
)

// No model is called "default" to the page or to ir (the user, 2026-11-16): what goes out names
// the model. "" and "default" are still taken as input, the agents' own.

// NamedModels is models without an entry of its own for "default" (Claude's): the model it
// resolves to is marked Default instead; one not listed takes its place under its real name (the
// head of its description, "Opus 5.5 · …", else the id); one that cannot be named is left out.
func NamedModels(models []Model) []Model {
	i := slices.IndexFunc(models, func(m Model) bool { return m.Value == "default" })
	if i < 0 {
		return models
	}
	def := models[i]
	out := slices.Delete(slices.Clone(models), i, i+1)
	if def.Resolved != "" {
		for j := range out {
			if out[j].Resolved == def.Resolved || out[j].Value == def.Resolved {
				out[j].Default = true
				return out
			}
		}
	}
	head, _, _ := strings.Cut(def.Description, " · ")
	name := cmp.Or(strings.TrimSpace(head), def.Resolved)
	if name == "" {
		return out
	}
	// Without the id it resolves to, it is still picked as "default".
	def.Value, def.Name, def.Default = cmp.Or(def.Resolved, "default"), name, true
	return slices.Insert(out, i, def)
}

// DefaultModel is the one of models marked Default; false with none.
func DefaultModel(models []Model) (Model, bool) {
	i := slices.IndexFunc(models, func(m Model) bool { return m.Default })
	if i < 0 {
		return Model{}, false
	}
	return models[i], true
}

// NameModel makes s say models by name: its list as NamedModels has it; Pick "default" is none
// set; Model, while the agent has named none, the one it runs by default, if the list says which.
func NameModel(s *SessionState) {
	s.Models = NamedModels(s.Models)
	if s.Pick == "default" {
		s.Pick = ""
	}
	if s.Model != "" && s.Model != "default" {
		return
	}
	s.Model = ""
	if m, ok := DefaultModel(s.Models); ok && m.Value != "default" {
		s.Model = cmp.Or(m.Resolved, m.Value)
	}
}
