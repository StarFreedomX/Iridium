// Package cron reads a time as cron writes it: five fields, minute, hour, day of the month,
// month, day of the week (0 or 7 Sunday); each "*", a number, a range "a-b", a list "a,b", a
// step "*/n" or "a-b/n". When both days are given (not "*"), either matching is enough, as cron
// has it.
package cron

import (
	"errors"
	"strconv"
	"strings"
	"time"
)

// Spec is a cron time read.
type Spec struct {
	min, hour, dom, mon, dow uint64 // a bit each value that matches
	anyDom, anyDow           bool
}

var ErrSpec = errors.New(`cron: five fields "m h dom mon dow" of *, numbers, a-b, a,b, */n`)

// Parse reads s.
func Parse(s string) (Spec, error) {
	f := strings.Fields(s)
	if len(f) != 5 {
		return Spec{}, ErrSpec
	}
	var sp Spec
	var err error
	bounds := [5][2]int{{0, 59}, {0, 23}, {1, 31}, {1, 12}, {0, 7}}
	out := []*uint64{&sp.min, &sp.hour, &sp.dom, &sp.mon, &sp.dow}
	for i, field := range f {
		if *out[i], err = parseField(field, bounds[i][0], bounds[i][1]); err != nil {
			return Spec{}, err
		}
	}
	if sp.dow&(1<<7) != 0 {
		sp.dow |= 1
	}
	sp.anyDom, sp.anyDow = f[2] == "*", f[4] == "*"
	return sp, nil
}

func parseField(f string, lo, hi int) (uint64, error) {
	var bits uint64
	for _, part := range strings.Split(f, ",") {
		rng, step := part, 1
		if r, st, ok := strings.Cut(part, "/"); ok {
			n, err := strconv.Atoi(st)
			if err != nil || n < 1 {
				return 0, ErrSpec
			}
			rng, step = r, n
		}
		a, b := lo, hi
		if rng != "*" {
			x, y, isRange := strings.Cut(rng, "-")
			var err error
			if a, err = strconv.Atoi(x); err != nil {
				return 0, ErrSpec
			}
			b = a
			if isRange {
				if b, err = strconv.Atoi(y); err != nil {
					return 0, ErrSpec
				}
			} else if step > 1 {
				b = hi // "5/15": from 5 on
			}
		}
		if a < lo || b > hi || a > b {
			return 0, ErrSpec
		}
		for v := a; v <= b; v += step {
			bits |= 1 << v
		}
	}
	return bits, nil
}

// Match: the minute of t is one of the spec's.
func (s Spec) Match(t time.Time) bool {
	has := func(bits uint64, v int) bool { return bits&(1<<v) != 0 }
	if !has(s.min, t.Minute()) || !has(s.hour, t.Hour()) || !has(s.mon, int(t.Month())) {
		return false
	}
	dom, dow := has(s.dom, t.Day()), has(s.dow, int(t.Weekday()))
	switch {
	case s.anyDom && s.anyDow:
		return true
	case s.anyDom:
		return dow
	case s.anyDow:
		return dom
	}
	return dom || dow
}

// Next is the first minute after t that matches, within a year and a day; zero if none.
func (s Spec) Next(t time.Time) time.Time {
	t = t.Truncate(time.Minute).Add(time.Minute)
	for end := t.AddDate(1, 0, 1); t.Before(end); t = t.Add(time.Minute) {
		if s.Match(t) {
			return t
		}
	}
	return time.Time{}
}
