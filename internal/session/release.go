package session

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"github.com/kumoSleeping/iridium/internal/agent"
)

// A release: the running process put in manual mode for a while, a person having approved its
// agent's ask for it (manual.go): only the process, the session's setting stays, so a restart is
// back in its own mode. It ends with the turn under way when it was approved (none under way: the
// next), or when its minutes pass, whichever comes first; then the mode goes back, unless a person
// set one meanwhile. A step auto mode denied is a failed call like any other: Claude may ask for
// this (kumo, 2026-11-25). A release is kept on disk (fileRelease): a daemon taking the process up
// goes on with it, rather than leave the process in manual mode.

// releaseMode is the mode a release runs in: every call not allowed by a rule is asked.
const releaseMode = "manual"

// fileRelease: a release under way (releaseMeta), in the hold directory.
const fileRelease = "release.json"

// releaseMeta is a release on disk: the process it put in manual mode, the mode to go back to,
// when it ends at the latest (ms).
type releaseMeta struct {
	Proc  int    `json:"proc"`
	Prev  string `json:"prev"`
	Until int64  `json:"until,omitempty"`
}

// released is a release under way: the mode to go back to; at: when it began; during: a turn
// was under way then, its end ends the release; until: it ends then at the latest (its timer).
type released struct {
	prev   string
	at     time.Time
	during bool
	until  time.Time
	timer  *time.Timer
}

// setRelLocked starts a release, or ends it (nil), on disk too. Its end, at the latest, is timed.
func (h *Hosted) setRelLocked(r *released) {
	h.dropRelLocked()
	h.rel = r
	if r != nil && !r.until.IsZero() && h.m != nil {
		r.timer = time.AfterFunc(time.Until(r.until), func() { h.releaseDue(r) })
	}
	if h.dir == "" {
		return
	}
	path := filepath.Join(h.dir, fileRelease)
	if r == nil {
		_ = os.Remove(path)
		return
	}
	m := releaseMeta{Proc: h.proc, Prev: r.prev}
	if !r.until.IsZero() {
		m.Until = r.until.UnixMilli()
	}
	if err := writeJSON(path, m); err != nil {
		h.logf("release: %v", err)
	}
}

// dropRelLocked forgets the release under way, if any, leaving its file.
func (h *Hosted) dropRelLocked() {
	if r := h.rel; r != nil && r.timer != nil {
		r.timer.Stop()
	}
	h.rel = nil
}

// releaseDue: release r's minutes passed; if it is still under way, the mode goes back.
func (h *Hosted) releaseDue(r *released) {
	h.mu.Lock()
	if h.rel != r {
		h.mu.Unlock()
		return
	}
	h.setRelLocked(nil)
	mode := h.backLocked(r)
	h.mu.Unlock()
	if mode != "" {
		h.logf("manual mode's minutes passed: back to %s mode", mode)
		h.restoreMode(mode)
	}
}

// helloReleaseLocked: process proc said hello in mode. The process an earlier daemon put in manual
// mode for a release, taken up, is in it still: the release goes on (from now, the turn under way
// ending it; its minutes as they were). Else none is under way.
func (h *Hosted) helloReleaseLocked(proc int, mode string) {
	h.dropRelLocked()
	if h.dir == "" {
		return
	}
	var m releaseMeta
	b, err := os.ReadFile(filepath.Join(h.dir, fileRelease))
	if err != nil || json.Unmarshal(b, &m) != nil || m.Proc != proc || !isManual(mode) || isManual(m.Prev) {
		h.setRelLocked(nil)
		return
	}
	busy := h.turn != "" && h.turn != agent.Idle
	r := &released{prev: m.Prev, at: time.Now(), during: busy}
	if m.Until != 0 {
		r.until = time.UnixMilli(m.Until)
	}
	h.setRelLocked(r)
	h.mode = releaseMode
	h.logf("manual mode goes on (back to %s mode after)", m.Prev)
}

// isManual: Claude's mode that asks for every call not allowed by a rule ("default" its old name).
func isManual(mode string) bool { return mode == releaseMode || mode == "default" }

// releaseOverLocked ends a release with the turn under way at it, or begun after it. It gives the
// mode to go back to, "" for none.
func (h *Hosted) releaseOverLocked() string {
	r := h.rel
	if r == nil || (!r.during && !h.turnAt.After(r.at)) {
		return ""
	}
	h.setRelLocked(nil)
	return h.backLocked(r)
}

// backLocked is the mode to go back to after release r, "" for none: you set one meanwhile, or
// it was asking already.
func (h *Hosted) backLocked(r *released) string {
	if h.mode != releaseMode || isManual(r.prev) {
		return ""
	}
	return r.prev
}

// restoreMode puts the process back in mode after a release.
func (h *Hosted) restoreMode(mode string) {
	ctx, cancel := context.WithTimeout(h.m.ctx, 30*time.Second)
	defer cancel()
	if !h.isLive() {
		return
	}
	if err := h.drv.SetMode(ctx, mode); err != nil {
		h.logf("release: back to %s mode: %v", mode, err)
		return
	}
	h.mu.Lock()
	if h.rel == nil {
		h.mode = mode
	}
	h.mu.Unlock()
	h.publish()
	h.m.publishList()
}
