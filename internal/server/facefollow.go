package server

import "github.com/kumoSleeping/iridium/internal/session"

// faceFollows keeps a session's face its model's as the model becomes known or changes: a session
// with no face of its own shows the one of its model (modelAvatarKey), and a page asks for a face
// only when the state "avatars" moves. One started at another computer has no model till its
// agent there says it, after the page first asked: it was left with the logo, or with the face of
// what the page had picked (kumo, 2026-11-19). The faces are asked for again when what a session
// shows is another face than before.
func (s *Server) faceFollows(n session.Notice) {
	if n.Kind != session.NoticeModel {
		return
	}
	// Apart from the notice: it may be told with the session's locks held.
	go func(id string) {
		st, err := s.m.State(id)
		if err != nil {
			return
		}
		_, v, _ := s.avatarOf(id, st)
		s.faceMu.Lock()
		if s.faceSeen == nil {
			s.faceSeen = map[string]string{}
		}
		was := s.faceSeen[id]
		s.faceSeen[id] = v
		s.faceMu.Unlock()
		if v != was {
			s.hub.Set("avatars", s.avatarsSeq.Add(1))
		}
	}(n.Session)
}
