package store

import "testing"

// What an agent was not given after all is not kept as given; what is kept by name is found by
// the start of its name.
func TestInjectionRemovedAndKeptUnder(t *testing.T) {
	s, _ := open(t)
	for _, in := range []Injection{{Session: "s1", Channel: "c", Input: "i1", Seq: 1, Record: "{}"}, {Session: "s1", Channel: "c", Input: "i2", Seq: 2, Record: "{}"}} {
		if err := s.AddInjection(in); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.RemoveInjection("s1", "i2"); err != nil {
		t.Fatal(err)
	}
	if rows, err := s.Injections("s1", 0); err != nil || len(rows) != 1 || rows[0].Input != "i1" {
		t.Errorf("injections: %+v %v", rows, err)
	}
	for k, v := range map[string]string{"calls:a": "1", "calls:b": "2", "callsx": "3", "other": "4"} {
		if err := s.Keep(k, v); err != nil {
			t.Fatal(err)
		}
	}
	if got, err := s.KeptUnder("calls:"); err != nil || len(got) != 2 || got["calls:a"] != "1" || got["calls:b"] != "2" {
		t.Errorf("kept under calls: %+v %v", got, err)
	}
}
