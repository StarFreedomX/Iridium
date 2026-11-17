package store

import (
	"database/sql"
	"errors"
	"strings"
)

// scriptsSchema is part of migration 44: the scripts of a channel (docs/channels.md "脚本"),
// each under its name there, run by Iridium (the channel's IR) when one of its triggers fires;
// and what each run did, the latest of each script kept.
const scriptsSchema = `CREATE TABLE IF NOT EXISTS channel_scripts (
		channel    TEXT NOT NULL,
		name       TEXT NOT NULL COLLATE NOCASE,
		intro      TEXT NOT NULL DEFAULT '',
		avatar     TEXT NOT NULL DEFAULT '',
		run        TEXT NOT NULL,
		triggers   TEXT NOT NULL DEFAULT '[]',
		enabled    INTEGER NOT NULL DEFAULT 1,
		made       TEXT NOT NULL DEFAULT '',
		changed    TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL,
		changed_at INTEGER NOT NULL,
		PRIMARY KEY (channel, name)
	);
	CREATE TABLE IF NOT EXISTS script_runs (
		id      INTEGER PRIMARY KEY AUTOINCREMENT,
		channel TEXT NOT NULL,
		name    TEXT NOT NULL COLLATE NOCASE,
		at      INTEGER NOT NULL,
		ms      INTEGER NOT NULL DEFAULT 0,
		trigger TEXT NOT NULL DEFAULT '',
		seq     INTEGER NOT NULL DEFAULT 0,
		code    INTEGER NOT NULL DEFAULT 0,
		said    INTEGER NOT NULL DEFAULT 0,
		out     TEXT NOT NULL DEFAULT '',
		err     TEXT NOT NULL DEFAULT ''
	);
	CREATE INDEX IF NOT EXISTS script_runs_script ON script_runs (channel, name, id);`

// Script is a script of a channel. Triggers: its triggers as JSON; Made, Changed: who made it
// and who changed it last, as JSON (api.ScriptBy).
type Script struct {
	Channel   string
	Name      string
	Intro     string
	Avatar    string
	Run       string
	Triggers  string
	Enabled   bool
	Made      string
	Changed   string
	CreatedAt int64
	ChangedAt int64
}

// ErrScriptTaken: the channel has a script of that name.
var ErrScriptTaken = errors.New("the channel has a script of that name")

const scriptCols = `channel, name, intro, avatar, run, triggers, enabled, made, changed, created_at, changed_at`

func scanScript(r interface{ Scan(...any) error }) (Script, error) {
	var x Script
	err := r.Scan(&x.Channel, &x.Name, &x.Intro, &x.Avatar, &x.Run, &x.Triggers, &x.Enabled, &x.Made, &x.Changed, &x.CreatedAt, &x.ChangedAt)
	return x, err
}

// Scripts are channel's scripts by name; channel "": every channel's.
func (s *Store) Scripts(channel string) ([]Script, error) {
	q, args := `SELECT `+scriptCols+` FROM channel_scripts ORDER BY channel, created_at, name`, []any{}
	if channel != "" {
		q, args = `SELECT `+scriptCols+` FROM channel_scripts WHERE channel = ? ORDER BY created_at, name`, []any{channel}
	}
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Script
	for rows.Next() {
		x, err := scanScript(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// Script is channel's script name (any case).
func (s *Store) Script(channel, name string) (Script, bool, error) {
	x, err := scanScript(s.db.QueryRow(`SELECT `+scriptCols+` FROM channel_scripts WHERE channel = ? AND name = ?`, channel, name))
	if errors.Is(err, sql.ErrNoRows) {
		return Script{}, false, nil
	}
	return x, err == nil, err
}

// AddScript keeps a new script; ErrScriptTaken when its channel has one of its name.
func (s *Store) AddScript(x Script) error {
	if x.CreatedAt == 0 {
		x.CreatedAt = now()
	}
	if x.ChangedAt == 0 {
		x.ChangedAt = x.CreatedAt
	}
	_, err := s.db.Exec(`INSERT INTO channel_scripts (`+scriptCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		x.Channel, x.Name, x.Intro, x.Avatar, x.Run, x.Triggers, x.Enabled, x.Made, x.Changed, x.CreatedAt, x.ChangedAt)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return ErrScriptTaken
	}
	return err
}

// PutScript writes script was (by its channel and name) as x, renamed where x's name is another;
// its runs go with it.
func (s *Store) PutScript(was string, x Script) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`UPDATE channel_scripts SET name = ?, intro = ?, avatar = ?, run = ?, triggers = ?, enabled = ?, changed = ?, changed_at = ? WHERE channel = ? AND name = ?`,
		x.Name, x.Intro, x.Avatar, x.Run, x.Triggers, x.Enabled, x.Changed, x.ChangedAt, x.Channel, was)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return ErrScriptTaken
		}
		return err
	}
	if !strings.EqualFold(was, x.Name) {
		if _, err := tx.Exec(`UPDATE script_runs SET name = ? WHERE channel = ? AND name = ?`, x.Name, x.Channel, was); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RemoveScript takes channel's script name away, its runs with it.
func (s *Store) RemoveScript(channel, name string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM channel_scripts WHERE channel = ? AND name = ?`, channel, name)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	_, err = s.db.Exec(`DELETE FROM script_runs WHERE channel = ? AND name = ?`, channel, name)
	return n > 0, err
}

// ScriptRun is what one run of a script did: Trigger, what fired it ("message", "command",
// "cron", "event", "hand"); Seq, the message that did; Code, its exit code (-1: it did not
// finish, Err says why); Said, the message its output was said as; Out, Err, its output and its
// errors, cut.
type ScriptRun struct {
	ID      int64
	Channel string
	Name    string
	At      int64
	Ms      int64
	Trigger string
	Seq     int64
	Code    int
	Said    int64
	Out     string
	Err     string
}

// ScriptRunsKept is how many runs of each script are kept.
const ScriptRunsKept = 50

// AddScriptRun keeps r, and the latest ScriptRunsKept of its script alone.
func (s *Store) AddScriptRun(r ScriptRun) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO script_runs (channel, name, at, ms, trigger, seq, code, said, out, err) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.Channel, r.Name, r.At, r.Ms, r.Trigger, r.Seq, r.Code, r.Said, r.Out, r.Err)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	_, err = s.db.Exec(`DELETE FROM script_runs WHERE channel = ? AND name = ? AND id <= (SELECT id FROM script_runs WHERE channel = ? AND name = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`,
		r.Channel, r.Name, r.Channel, r.Name, ScriptRunsKept)
	return id, err
}

// ScriptRuns are the latest limit runs of channel's script name, newest first.
func (s *Store) ScriptRuns(channel, name string, limit int) ([]ScriptRun, error) {
	rows, err := s.db.Query(`SELECT id, channel, name, at, ms, trigger, seq, code, said, out, err FROM script_runs WHERE channel = ? AND name = ? ORDER BY id DESC LIMIT ?`, channel, name, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ScriptRun
	for rows.Next() {
		var r ScriptRun
		if err := rows.Scan(&r.ID, &r.Channel, &r.Name, &r.At, &r.Ms, &r.Trigger, &r.Seq, &r.Code, &r.Said, &r.Out, &r.Err); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
