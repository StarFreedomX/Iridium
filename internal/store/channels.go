package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/kumoSleeping/iridium/internal/search"
)

// Channels (docs/channels.md): a channel is where people and agents talk; its id is the id of the
// session it began as. It keeps what was said, each message under its number (seq, from 1, never
// reused), and who is in it. An agent's own record (its thinking, its tool calls) is not here:
// only what it said, read in from that record up to channel_sync's offset.
const channelsSchema = `CREATE TABLE IF NOT EXISTS channel_members (
		channel   TEXT NOT NULL,
		member    TEXT NOT NULL,
		nick      TEXT NOT NULL DEFAULT '',
		recv      TEXT NOT NULL DEFAULT '',
		seen      INTEGER NOT NULL DEFAULT 0,
		joined_at INTEGER NOT NULL,
		PRIMARY KEY (channel, member)
	);
	CREATE INDEX IF NOT EXISTS channel_members_member ON channel_members (member);
	CREATE TABLE IF NOT EXISTS channel_messages (
		channel   TEXT NOT NULL,
		seq       INTEGER NOT NULL,
		author    TEXT NOT NULL,
		name      TEXT NOT NULL DEFAULT '',
		kind      TEXT NOT NULL,
		text      TEXT NOT NULL,
		data      TEXT NOT NULL DEFAULT '',
		ref       TEXT NOT NULL DEFAULT '',
		origin    TEXT NOT NULL DEFAULT '',
		hop       INTEGER NOT NULL DEFAULT 0,
		at        INTEGER NOT NULL,
		edited_at INTEGER NOT NULL DEFAULT 0,
		gone      INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (channel, seq)
	);
	CREATE UNIQUE INDEX IF NOT EXISTS channel_messages_ref ON channel_messages (channel, ref) WHERE ref != '';
	CREATE TABLE IF NOT EXISTS channel_sync (
		session TEXT PRIMARY KEY,
		record  TEXT NOT NULL DEFAULT '',
		offset  INTEGER NOT NULL DEFAULT 0
	);`

// ChannelMember is one member of a channel. Member: "agent:<session>", an app's login
// "<app>/<login>", or all of an app's "<app>/*". Recv: what wakes an agent ("all": what people
// say; "at": only what names it), what a person is shown ("all", "mine"). Seen: the number of the
// last message it has been given.
type ChannelMember struct {
	Channel string
	Member  string
	Nick    string
	Recv    string
	Seen    int64
	Joined  int64
}

// ChannelMessage is one message of a channel. Kind: "user" (a person's), "said" (an agent's
// words), "ask", "error", "note" (Iridium's own line). Data: JSON, the kind's own (files, who is
// named, the activity). Ref: where it is from, unique in the channel: an input's id, a block of
// an agent's record "b:<session>:<at>", an ask's card. Origin: who began the chain it is in; Hop:
// how many agents passed it on since.
type ChannelMessage struct {
	Channel string
	Seq     int64
	Author  string
	Name    string
	Kind    string
	Text    string
	Data    string
	Ref     string
	Origin  string
	Hop     int
	At      int64
	Edited  int64
	Gone    bool
}

const messageCols = `channel, seq, author, name, kind, text, data, ref, origin, hop, at, edited_at, gone`

func scanMessage(r interface{ Scan(...any) error }) (ChannelMessage, error) {
	var m ChannelMessage
	err := r.Scan(&m.Channel, &m.Seq, &m.Author, &m.Name, &m.Kind, &m.Text, &m.Data, &m.Ref, &m.Origin, &m.Hop, &m.At, &m.Edited, &m.Gone)
	return m, err
}

// AddChannelMessage appends m to its channel under the next number, which it returns. One with
// a Ref the channel already has is not added again: added false, the number it has.
func (s *Store) AddChannelMessage(m ChannelMessage) (seq int64, added bool, err error) {
	if m.At == 0 {
		m.At = now()
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, false, err
	}
	defer tx.Rollback()
	if m.Ref != "" {
		err := tx.QueryRow(`SELECT seq FROM channel_messages WHERE channel = ? AND ref = ?`, m.Channel, m.Ref).Scan(&seq)
		if err == nil {
			return seq, false, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return 0, false, err
		}
	}
	if err := tx.QueryRow(`SELECT COALESCE(MAX(seq), 0) + 1 FROM channel_messages WHERE channel = ?`, m.Channel).Scan(&seq); err != nil {
		return 0, false, err
	}
	res, err := tx.Exec(`INSERT INTO channel_messages (`+messageCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
		m.Channel, seq, m.Author, m.Name, m.Kind, m.Text, m.Data, m.Ref, m.Origin, m.Hop, m.At)
	if err != nil {
		return 0, false, err
	}
	if id, err := res.LastInsertId(); err == nil {
		if _, err := tx.Exec(`INSERT INTO channel_fts (rowid, terms) VALUES (?, ?)`, id, search.Terms(indexed(m.Text, m.Data))); err != nil {
			return 0, false, err
		}
	}
	return seq, true, tx.Commit()
}

// indexed is what a message is found by: its words, and the files and programs its data names
// (the paths its agent changed, what it ran).
func indexed(text, data string) string {
	if data == "" || !strings.Contains(data, `"activity"`) {
		return text
	}
	var d struct {
		Activity struct {
			Cmds  map[string]int `json:"cmds"`
			Files []struct {
				Path string `json:"path"`
			} `json:"files"`
		} `json:"activity"`
	}
	if json.Unmarshal([]byte(data), &d) != nil {
		return text
	}
	var b strings.Builder
	b.WriteString(text)
	for _, f := range d.Activity.Files {
		b.WriteString("\n" + f.Path)
	}
	for c := range d.Activity.Cmds {
		b.WriteString("\n" + c)
	}
	return b.String()
}

// reindex writes message seq of channel into the index again, as it is now.
func (s *Store) reindex(channel string, seq int64) error {
	var id int64
	var text, data string
	var gone bool
	if err := s.db.QueryRow(`SELECT rowid, text, data, gone FROM channel_messages WHERE channel = ? AND seq = ?`, channel, seq).Scan(&id, &text, &data, &gone); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM channel_fts WHERE rowid = ?`, id); err != nil || gone {
		return err
	}
	_, err := s.db.Exec(`INSERT INTO channel_fts (rowid, terms) VALUES (?, ?)`, id, search.Terms(indexed(text, data)))
	return err
}

// indexChannelMessages indexes every message there is (the migration that made the index).
func indexChannelMessages(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT rowid, text, data FROM channel_messages WHERE gone = 0`)
	if err != nil {
		return err
	}
	type row struct {
		id         int64
		text, data string
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.text, &r.data); err != nil {
			rows.Close()
			return err
		}
		all = append(all, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, r := range all {
		if _, err := tx.Exec(`INSERT OR REPLACE INTO channel_fts (rowid, terms) VALUES (?, ?)`, r.id, search.Terms(indexed(r.text, r.data))); err != nil {
			return err
		}
	}
	return nil
}

// SearchChannelMessages are the messages of channel that have all of words (search.Query), the
// latest limit of them, in order; none for words with no term.
func (s *Store) SearchChannelMessages(channel, words string, limit int) ([]ChannelMessage, error) {
	q := search.Query(words)
	out := []ChannelMessage{}
	if q == "" {
		return out, nil
	}
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT * FROM (SELECT m.channel, m.seq, m.author, m.name, m.kind, m.text, m.data, m.ref, m.origin, m.hop, m.at, m.edited_at, m.gone
		FROM channel_fts f JOIN channel_messages m ON m.rowid = f.rowid
		WHERE f.terms MATCH ? AND m.channel = ? AND m.gone = 0 ORDER BY m.seq DESC LIMIT ?) ORDER BY seq`, q, channel, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ChannelMessage is message seq of channel; false if there is none.
func (s *Store) ChannelMessage(channel string, seq int64) (ChannelMessage, bool, error) {
	return s.oneMessage(`SELECT `+messageCols+` FROM channel_messages WHERE channel = ? AND seq = ?`, channel, seq)
}

// ChannelMessageByRef is the message of channel that is from ref; false if there is none.
func (s *Store) ChannelMessageByRef(channel, ref string) (ChannelMessage, bool, error) {
	if ref == "" {
		return ChannelMessage{}, false, nil
	}
	return s.oneMessage(`SELECT `+messageCols+` FROM channel_messages WHERE channel = ? AND ref = ?`, channel, ref)
}

func (s *Store) oneMessage(q string, args ...any) (ChannelMessage, bool, error) {
	m, err := scanMessage(s.db.QueryRow(q, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return ChannelMessage{}, false, nil
	}
	return m, err == nil, err
}

// ChannelMessages are up to limit messages of channel in order: those after seq `after` (after
// >= 0), else the last ones before seq `before` (before <= 0: the latest). Gone ones are left out.
func (s *Store) ChannelMessages(channel string, before, after int64, limit int) ([]ChannelMessage, error) {
	if limit <= 0 {
		limit = 100
	}
	var rows *sql.Rows
	var err error
	if after >= 0 {
		rows, err = s.db.Query(`SELECT `+messageCols+` FROM channel_messages WHERE channel = ? AND seq > ? AND gone = 0 ORDER BY seq LIMIT ?`, channel, after, limit)
	} else {
		if before <= 0 {
			before = 1 << 62
		}
		rows, err = s.db.Query(`SELECT * FROM (SELECT `+messageCols+` FROM channel_messages WHERE channel = ? AND seq < ? AND gone = 0 ORDER BY seq DESC LIMIT ?) ORDER BY seq`, channel, before, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChannelMessage{}
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ChannelEnd is the number of channel's last message (gone or not); 0 if it has none.
func (s *Store) ChannelEnd(channel string) (int64, error) {
	var n int64
	err := s.db.QueryRow(`SELECT COALESCE(MAX(seq), 0) FROM channel_messages WHERE channel = ?`, channel).Scan(&n)
	return n, err
}

// UnanchoredMessages are channel's latest messages by author with no Ref, newest first: what
// was said live and not yet found in the agent's record.
func (s *Store) UnanchoredMessages(channel, author string, limit int) ([]ChannelMessage, error) {
	rows, err := s.db.Query(`SELECT `+messageCols+` FROM channel_messages WHERE channel = ? AND author = ? AND ref = '' ORDER BY seq DESC LIMIT ?`, channel, author, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChannelMessage
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// AnchorMessage says message seq of channel is from ref (and has data, if not ""): false if
// another message is already from it.
func (s *Store) AnchorMessage(channel string, seq int64, ref, data string) (bool, error) {
	res, err := s.db.Exec(`UPDATE OR IGNORE channel_messages SET ref = ?, data = CASE WHEN ? = '' THEN data ELSE ? END WHERE channel = ? AND seq = ?`, ref, data, data, channel, seq)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n > 0 && data != "" {
		err = s.reindex(channel, seq)
	}
	return n > 0, err
}

// EditChannelMessage changes message seq's text.
func (s *Store) EditChannelMessage(channel string, seq int64, text string) error {
	if _, err := s.db.Exec(`UPDATE channel_messages SET text = ?, edited_at = ? WHERE channel = ? AND seq = ?`, text, now(), channel, seq); err != nil {
		return err
	}
	return s.reindex(channel, seq)
}

// SetChannelMessageData changes message seq's data.
func (s *Store) SetChannelMessageData(channel string, seq int64, data string) error {
	_, err := s.db.Exec(`UPDATE channel_messages SET data = ? WHERE channel = ? AND seq = ?`, data, channel, seq)
	return err
}

// DropChannelMessage takes message seq back: its number stays, its words go.
func (s *Store) DropChannelMessage(channel string, seq int64) error {
	if _, err := s.db.Exec(`UPDATE channel_messages SET gone = 1, text = '', data = '', edited_at = ? WHERE channel = ? AND seq = ?`, now(), channel, seq); err != nil {
		return err
	}
	return s.reindex(channel, seq)
}

// ForgetChannelMessage is DropChannelMessage for one that was never sent: what it was from may
// be said again, as a new message.
func (s *Store) ForgetChannelMessage(channel string, seq int64) error {
	if _, err := s.db.Exec(`UPDATE channel_messages SET gone = 1, text = '', data = '', ref = '', edited_at = ? WHERE channel = ? AND seq = ?`, now(), channel, seq); err != nil {
		return err
	}
	return s.reindex(channel, seq)
}

// ---- members ----

// ChannelMembers are channel's members as written down, in the order they joined; none for a
// channel nobody has changed (its members are then the default: channel.Service.Members).
func (s *Store) ChannelMembers(channel string) ([]ChannelMember, error) {
	return s.members(`SELECT channel, member, nick, recv, seen, joined_at FROM channel_members WHERE channel = ? ORDER BY joined_at, rowid`, channel)
}

// AllChannelMembers are every channel's members as written.
func (s *Store) AllChannelMembers() ([]ChannelMember, error) {
	return s.members(`SELECT channel, member, nick, recv, seen, joined_at FROM channel_members ORDER BY joined_at, rowid`)
}

// ChannelsOf are the memberships of member, in every channel.
func (s *Store) ChannelsOf(member string) ([]ChannelMember, error) {
	return s.members(`SELECT channel, member, nick, recv, seen, joined_at FROM channel_members WHERE member = ? ORDER BY joined_at, rowid`, member)
}

// AgentMemberships are all the agents' memberships: which channel each session talks in.
func (s *Store) AgentMemberships() ([]ChannelMember, error) {
	return s.members(`SELECT channel, member, nick, recv, seen, joined_at FROM channel_members WHERE member LIKE 'agent:%' ORDER BY joined_at, rowid`)
}

func (s *Store) members(q string, args ...any) ([]ChannelMember, error) {
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChannelMember
	for rows.Next() {
		var m ChannelMember
		if err := rows.Scan(&m.Channel, &m.Member, &m.Nick, &m.Recv, &m.Seen, &m.Joined); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// PutChannelMember adds m to its channel, or changes its nick and what it receives.
func (s *Store) PutChannelMember(m ChannelMember) error {
	if m.Joined == 0 {
		m.Joined = now()
	}
	_, err := s.db.Exec(`INSERT INTO channel_members (channel, member, nick, recv, seen, joined_at) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (channel, member) DO UPDATE SET nick = excluded.nick, recv = excluded.recv`,
		m.Channel, m.Member, m.Nick, m.Recv, m.Seen, m.Joined)
	return err
}

// RemoveChannelMember takes member out of channel; false if it was not in it.
func (s *Store) RemoveChannelMember(channel, member string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM channel_members WHERE channel = ? AND member = ?`, channel, member)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// SetChannelSeen moves member's read position in channel up to seq (never back).
func (s *Store) SetChannelSeen(channel, member string, seq int64) error {
	_, err := s.db.Exec(`UPDATE channel_members SET seen = MAX(seen, ?) WHERE channel = ? AND member = ?`, seq, channel, member)
	return err
}

// ---- reading an agent's record in ----

// ChannelSync is how far session's record has been read into its channel: offset, the line
// after the last block read; pending, what its agent did since it last spoke (JSON, the
// channel package's); ok false: never read.
func (s *Store) ChannelSync(session string) (offset int64, pending string, ok bool, err error) {
	err = s.db.QueryRow(`SELECT offset, pending FROM channel_sync WHERE session = ?`, session).Scan(&offset, &pending)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, "", false, nil
	}
	return offset, pending, err == nil, err
}

func (s *Store) SetChannelSync(session string, offset int64, pending string) error {
	_, err := s.db.Exec(`INSERT INTO channel_sync (session, offset, pending) VALUES (?, ?, ?)
		ON CONFLICT (session) DO UPDATE SET offset = excluded.offset, pending = excluded.pending`, session, offset, pending)
	return err
}

// AgentMember is the member a session is.
func AgentMember(session string) string { return "agent:" + session }

// SessionOfMember is the session member is, if it is an agent.
func SessionOfMember(member string) (string, bool) {
	return strings.CutPrefix(member, "agent:")
}

// ---- what an agent was given ----

// Injection is what session's agent was given once (assemble.Record as JSON): for message Seq
// of Channel, written to it as Input.
type Injection struct {
	ID      int64
	Session string
	Channel string
	Input   string
	Seq     int64
	At      int64
	Record  string
}

// InjectionsKept is how many a session keeps: the latest.
const InjectionsKept = 200

// AddInjection keeps in; the session's oldest beyond InjectionsKept go.
func (s *Store) AddInjection(in Injection) error {
	if in.At == 0 {
		in.At = now()
	}
	if _, err := s.db.Exec(`INSERT INTO injections (session, channel, input, seq, at, record) VALUES (?, ?, ?, ?, ?, ?)`,
		in.Session, in.Channel, in.Input, in.Seq, in.At, in.Record); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM injections WHERE session = ? AND id <= (SELECT id FROM injections WHERE session = ? ORDER BY id DESC LIMIT 1 OFFSET ?)`,
		in.Session, in.Session, InjectionsKept)
	return err
}

// Injections are session's latest limit injections, newest first.
func (s *Store) Injections(session string, limit int) ([]Injection, error) {
	if limit <= 0 || limit > InjectionsKept {
		limit = InjectionsKept
	}
	rows, err := s.db.Query(`SELECT id, session, channel, input, seq, at, record FROM injections WHERE session = ? ORDER BY id DESC LIMIT ?`, session, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Injection{}
	for rows.Next() {
		var in Injection
		if err := rows.Scan(&in.ID, &in.Session, &in.Channel, &in.Input, &in.Seq, &in.At, &in.Record); err != nil {
			return nil, err
		}
		out = append(out, in)
	}
	return out, rows.Err()
}
