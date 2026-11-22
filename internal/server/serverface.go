package server

import (
	"net/http"

	"github.com/kumoSleeping/iridium/internal/gate"
)

// This Iridium's face (docs/app.md "服务器头像", kumo 2026-11-20): what stands for it where it is
// one among others (the desktop app's list of Iridiums). Inside, Iridium keeps its own mark.
// Seen by anyone (the app shows it before logging in); set by a person who manages it.
const serverFaceKey = "server:face"

func (s *Server) serverFaceRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /v1/internal/face", s.serverFaceGet)
	mux.HandleFunc("PUT /v1/internal/face", s.serverFacePut)
	mux.HandleFunc("DELETE /v1/internal/face", s.serverFacePut)
}

func (s *Server) serverFaceGet(w http.ResponseWriter, r *http.Request) {
	img, v, ok, err := s.st.Avatar(serverFaceKey)
	if err != nil {
		s.fault(w, err)
		return
	}
	if !ok {
		refuse(w, http.StatusNotFound, "not_found", "no face set")
		return
	}
	serveFace(w, r, img, v)
}

func (s *Server) serverFacePut(w http.ResponseWriter, r *http.Request) {
	if !callerOf(r).CanManage() {
		refuse(w, http.StatusForbidden, "forbidden", "managers only")
		return
	}
	if r.Method == http.MethodDelete {
		if err := s.st.DeleteAvatar(serverFaceKey); err != nil {
			s.fault(w, err)
			return
		}
	} else {
		img, v, ok := avatarBody(w, r)
		if !ok {
			return
		}
		if err := s.st.PutAvatar(serverFaceKey, img, v); err != nil {
			s.fault(w, err)
			return
		}
	}
	s.hub.Set("avatars", s.avatarsSeq.Add(1))
	w.WriteHeader(http.StatusNoContent)
}

// hostStore keeps the host's own name and face (gate host.go) in the store: the name under
// host:name (meta), the face under host:face (avatars).
type hostStore struct{ s *Server }

func (h hostStore) LoadHost() (gate.HostProfile, error) {
	p := gate.HostProfile{Name: h.s.st.Kept("host:name")}
	img, v, ok, err := h.s.st.Avatar("host:face")
	if err != nil {
		return p, err
	}
	if ok {
		p.Avatar, p.AvatarVersion = img, v
	}
	return p, nil
}

func (h hostStore) SaveHost(p gate.HostProfile) error {
	if err := h.s.st.Keep("host:name", p.Name); err != nil {
		return err
	}
	if p.AvatarVersion == "" {
		return h.s.st.DeleteAvatar("host:face")
	}
	return h.s.st.PutAvatar("host:face", p.Avatar, p.AvatarVersion)
}
