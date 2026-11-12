package channel

import (
	"errors"
	"fmt"
	"strings"

	"github.com/kumoSleeping/iridium/internal/deliver"
	"github.com/kumoSleeping/iridium/internal/store"
)

var (
	ErrNick     = errors.New("a nick is letters, digits, _ and -, at most 32, and one member's alone")
	ErrNoMember = errors.New("no such member")
	ErrMember   = errors.New("already a member of a channel")
	ErrRecv     = errors.New("recv: all or at")
)

// written makes channel's default members rows of their own, once someone changes them: the
// web's logins and the session the channel is, which has seen everything said so far and keeps
// receiving everything. base names an agent's harness, for its nick.
func (s *Service) written(channel string, base func(session string) string) error {
	rows, err := s.st.ChannelMembers(channel)
	if err != nil || len(rows) > 0 {
		return err
	}
	s.Touch(channel)
	end, err := s.st.ChannelEnd(channel)
	if err != nil {
		return err
	}
	defer s.changed()
	if err := s.st.PutChannelMember(store.ChannelMember{Channel: channel, Member: WebAll, Recv: RecvAll}); err != nil {
		return err
	}
	return s.st.PutChannelMember(store.ChannelMember{Channel: channel, Member: store.AgentMember(channel), Nick: s.freeNick(channel, base(channel)), Recv: RecvAll, Seen: end})
}

// freeNick is a nick no member of channel has: base, else base2, base3…
func (s *Service) freeNick(channel, base string) string {
	base = strings.Map(func(r rune) rune {
		if deliver.ValidNick(string(r)) {
			return r
		}
		return -1
	}, strings.ToLower(base))
	if base == "" {
		base = "agent"
	}
	taken := map[string]bool{}
	rows, _ := s.st.ChannelMembers(channel)
	for _, r := range rows {
		taken[strings.ToLower(r.Nick)] = true
	}
	nick := base
	for i := 2; taken[nick]; i++ {
		nick = fmt.Sprintf("%s%d", base, i)
	}
	return nick
}

func (s *Service) nickFree(channel, member, nick string) bool {
	if !deliver.ValidNick(nick) {
		return false
	}
	rows, _ := s.st.ChannelMembers(channel)
	for _, r := range rows {
		if r.Member != member && strings.EqualFold(r.Nick, nick) {
			return false
		}
	}
	return true
}

// Join puts session's agent in channel: under nick ("": one made from its harness's name),
// receiving recv ("": only what names it). It has seen nothing of the channel yet. base names a
// session's harness.
func (s *Service) Join(channel, session, nick, recv string, base func(session string) string) (Member, error) {
	if session == channel || s.Of(session) != session || len(s.Agents(session)) > 1 {
		return Member{}, ErrMember
	}
	if recv == "" {
		recv = RecvAt
	}
	if recv != RecvAll && recv != RecvAt {
		return Member{}, ErrRecv
	}
	if err := s.written(channel, base); err != nil {
		return Member{}, err
	}
	member := store.AgentMember(session)
	if nick == "" {
		nick = s.freeNick(channel, base(session))
	} else if !s.nickFree(channel, member, nick) {
		return Member{}, ErrNick
	}
	// What its record holds by now is its own, from before it joined: not the channel's.
	if off, _, _, err := s.st.ChannelSync(session); err == nil {
		if p, err := s.ss.Messages(session, -1, off); err == nil {
			off = max(off, p.End)
		}
		_ = s.st.SetChannelSync(session, off, "")
	}
	row := store.ChannelMember{Channel: channel, Member: member, Nick: nick, Recv: recv}
	defer s.changed()
	if err := s.st.PutChannelMember(row); err != nil {
		return Member{}, err
	}
	return Member{ChannelMember: row, Session: session}, nil
}

// Leave takes member out of channel. The session the channel is stays in it.
func (s *Service) Leave(channel, member string) error {
	if member == store.AgentMember(channel) {
		return fmt.Errorf("%w: the channel is this session's", ErrNoMember)
	}
	defer s.changed()
	ok, err := s.st.RemoveChannelMember(channel, member)
	if err == nil && !ok {
		err = ErrNoMember
	}
	return err
}

// Change sets a member's nick and what it receives (nil: as it is).
func (s *Service) Change(channel, member string, nick, recv *string, base func(session string) string) (Member, error) {
	if err := s.written(channel, base); err != nil {
		return Member{}, err
	}
	ms, err := s.Members(channel)
	if err != nil {
		return Member{}, err
	}
	for _, m := range ms {
		if m.Member != member {
			continue
		}
		if nick != nil {
			if !m.Agent() || !s.nickFree(channel, member, *nick) {
				return Member{}, ErrNick
			}
			m.Nick = *nick
		}
		if recv != nil {
			ok := *recv == RecvAll || (m.Agent() && *recv == RecvAt) || (!m.Agent() && *recv == RecvMine)
			if !ok {
				return Member{}, ErrRecv
			}
			m.Recv = *recv
		}
		defer s.changed()
		return m, s.st.PutChannelMember(m.ChannelMember)
	}
	return Member{}, ErrNoMember
}

// Seen moves session's read position in its channel up to seq.
func (s *Service) Seen(channel, session string, seq int64) {
	defer s.changed()
	if err := s.st.SetChannelSeen(channel, store.AgentMember(session), seq); err != nil {
		s.logf("channel %s: %s read to %d: %v", channel, session, seq, err)
	}
}

// Between are channel's messages with numbers above after and below before, the latest limit
// of them, in order.
func (s *Service) Between(channel string, after, before int64, limit int) ([]Message, error) {
	rows, err := s.st.ChannelMessages(channel, before, -1, limit)
	if err != nil {
		return nil, err
	}
	var out []Message
	for _, r := range rows {
		if r.Seq > after {
			out = append(out, read(r))
		}
	}
	return out, nil
}
