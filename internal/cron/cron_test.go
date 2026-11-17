package cron

import (
	"testing"
	"time"
)

func TestCron(t *testing.T) {
	at := func(s string) time.Time {
		v, err := time.ParseInLocation("2006-01-02 15:04", s, time.Local)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	for spec, want := range map[string][]string{
		"0 9 * * *":       {"2026-11-17 09:00", "2026-11-18 09:00"},
		"*/15 * * * *":    {"2026-11-17 08:45", "2026-11-17 09:00"},
		"30 8-10/2 * * *": {"2026-11-17 10:30", "2026-11-18 08:30"},
		"0 0 1 * *":       {"2026-12-01 00:00", "2027-01-01 00:00"},
		"0 12 * * 0":      {"2026-11-22 12:00", "2026-11-29 12:00"},
		"0 12 * * 7":      {"2026-11-22 12:00", "2026-11-29 12:00"},
		"0 12 1 * 1":      {"2026-11-23 12:00", "2026-11-30 12:00"}, // a Monday or the 1st
	} {
		sp, err := Parse(spec)
		if err != nil {
			t.Fatalf("%q: %v", spec, err)
		}
		cur := at("2026-11-17 08:31") // a Tuesday
		for _, w := range want {
			cur = sp.Next(cur)
			if got := cur.Format("2006-01-02 15:04"); got != w {
				t.Errorf("%q: %s, want %s", spec, got, w)
			}
		}
	}
	for _, bad := range []string{"", "* * * *", "60 * * * *", "* 24 * * *", "*/0 * * * *", "5-1 * * * *", "a * * * *", "* * 0 * *"} {
		if _, err := Parse(bad); err == nil {
			t.Errorf("%q: read", bad)
		}
	}
}
