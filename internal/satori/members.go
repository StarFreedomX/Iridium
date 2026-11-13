package satori

import (
	"context"
	"net/http"

	"github.com/kumoSleeping/iridium/internal/store"
)

// A guild's members (guild.member.list, guild.member.get): the agents of its sessions, each the
// user "agent:<session>" with the nick it is called by, and the logins of the app that asks.
// With _data.channel_id (Iridium's own): the members of that channel alone, its agents with
// when each joined it.

// members are guild's members as c sees them; channel: of that channel only.
func (s *Service) members(ctx context.Context, c Caller, guild, channel string) ([]GuildMember, error) {
	out := []GuildMember{}
	if channel != "" {
		st, err := s.channel(c, channel)
		if err != nil {
			return nil, err
		}
		if s.log != nil {
			ms, err := s.log.Members(st.ID)
			if err != nil {
				return nil, err
			}
			for _, m := range ms {
				if m.Agent() {
					u := s.agentOf(m.Session)
					out = append(out, GuildMember{User: u, Nick: u.Nick, JoinedAt: m.Joined})
				}
			}
		}
	} else {
		l, err := s.b.Sessions(ctx)
		if err != nil {
			return nil, err
		}
		for _, ss := range l {
			if ss.Archived || ss.Subagent || ss.Bare || s.guildOf(ss).ID != guild || !s.b.Sees(c, ss.ID) {
				continue
			}
			u := s.agentOf(ss.ID)
			out = append(out, GuildMember{User: u, Nick: u.Nick, JoinedAt: ss.CreatedAt})
		}
	}
	for _, lg := range s.b.Logins(c.App) {
		out = append(out, GuildMember{User: &User{ID: lg.ID, Name: lg.Name}})
	}
	return out, nil
}

func (s *Service) guildMemberList(ctx context.Context, c Caller, body []byte) (any, error) {
	var req struct {
		GuildID string `json:"guild_id"`
		Next    string `json:"next"`
		Data    struct {
			ChannelID string `json:"channel_id"`
		} `json:"_data"`
	}
	if err := decode(body, &req); err != nil {
		return nil, err
	}
	g, err := s.guildOfRequest(c, req.GuildID, req.Data.ChannelID)
	if err != nil {
		return nil, err
	}
	all, err := s.members(ctx, c, g, req.Data.ChannelID)
	if err != nil {
		return nil, err
	}
	p, next, err := page(all, req.Next)
	if err != nil {
		return nil, err
	}
	return List[GuildMember]{Data: p, Next: next}, nil
}

func (s *Service) guildMemberGet(ctx context.Context, c Caller, body []byte) (any, error) {
	var req struct {
		GuildID string `json:"guild_id"`
		UserID  string `json:"user_id"`
		Data    struct {
			ChannelID string `json:"channel_id"`
		} `json:"_data"`
	}
	if err := decode(body, &req); err != nil {
		return nil, err
	}
	if req.UserID == "" {
		return nil, bad("user_id")
	}
	g, err := s.guildOfRequest(c, req.GuildID, req.Data.ChannelID)
	if err != nil {
		return nil, err
	}
	// An agent by its session, whatever the list's length.
	if id, ok := store.SessionOfMember(req.UserID); ok && req.Data.ChannelID == "" {
		st, err := s.channel(c, id)
		if err != nil || s.guildOf(st.Session).ID != g {
			return nil, refuse(http.StatusUnprocessableEntity, "no_such_user", "no member "+req.UserID)
		}
		u := s.agentOf(st.ID)
		return GuildMember{User: u, Nick: u.Nick, JoinedAt: st.CreatedAt}, nil
	}
	all, err := s.members(ctx, c, g, req.Data.ChannelID)
	if err != nil {
		return nil, err
	}
	for _, m := range all {
		if m.User != nil && m.User.ID == req.UserID {
			return m, nil
		}
	}
	return nil, refuse(http.StatusUnprocessableEntity, "no_such_user", "no member "+req.UserID)
}

// guildOfRequest is the guild a members request names: guild_id (self: the caller's), which c
// sees; with a channel only, none is needed.
func (s *Service) guildOfRequest(c Caller, guild, channel string) (string, error) {
	if guild == "" && channel != "" {
		return "", nil
	}
	g, err := s.guildID(c, guild)
	if err != nil {
		return "", err
	}
	if g == "" {
		return "", bad("guild_id")
	}
	if !s.guildThere(c, g) {
		return "", refuse(http.StatusUnprocessableEntity, "no_such_guild", "no guild "+g)
	}
	return g, nil
}
