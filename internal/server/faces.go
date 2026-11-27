package server

import (
	"encoding/json"
	"slices"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/store"
)

// The carried state "faces": the version of each face a page draws under a session's or channel's
// id, by "<id>" (its face, avatarOf) and "c:<id>" (as a channel, ?of=channel); "" for one with
// none, which the page draws as its logo without asking. The page asks for
// a face under its own version (?v=), so the answer is kept for good (serveFace), and one face
// changed is the only one asked for again (it was every face, under the count "avatars": the
// sidebar's faces blinked; kumo, 2026-11-23). The sessions the Discovery found that Iridium does
// not host are left out (their state is their transcript, read): the page asks for those under
// the count, as before.
const facesKey = "faces"

// facesChanged tells the pages a face changed: the count "avatars", and the faces' versions.
func (s *Server) facesChanged() {
	s.hub.Set("avatars", s.avatarsSeq.Add(1))
	s.facesSoon()
}

// facesSoon works the faces out again shortly: several changes at once, once.
func (s *Server) facesSoon() {
	s.faceMu.Lock()
	defer s.faceMu.Unlock()
	if s.faceDue {
		return
	}
	s.faceDue = true
	time.AfterFunc(100*time.Millisecond, func() {
		s.faceMu.Lock()
		s.faceDue = false
		s.faceMu.Unlock()
		s.hub.Set(facesKey, s.facesNow())
	})
}

// facesOnList works the faces out again as the list has other channels in it than before
// (one made, one taken over): theirs are new to the state.
func (s *Server) facesOnList(l []api.Session) {
	var b strings.Builder
	for _, x := range l {
		if x.Hosted || x.Bare {
			b.WriteString(x.ID)
			b.WriteByte(' ')
		}
	}
	s.faceMu.Lock()
	same := s.faceIDs == b.String()
	s.faceIDs = b.String()
	s.faceMu.Unlock()
	if !same {
		s.facesSoon()
	}
}

// knownFaces is what the store had at once: the profiles and the images' versions.
type knownFaces struct {
	profiles map[string]store.Profile
	versions map[string]string
}

func (k knownFaces) profile(key string) store.Profile { return k.profiles[key] }
func (k knownFaces) avatar(key string) ([]byte, string, bool) {
	v, ok := k.versions[key]
	return nil, v, ok
}

// facesNow is the state "faces" as it is now.
func (s *Server) facesNow() map[string]string {
	out := map[string]string{}
	var l []api.Session
	if json.Unmarshal(s.hub.Get("list"), &l) != nil {
		return out
	}
	profiles, err := s.st.Profiles("")
	if err != nil {
		return out
	}
	versions, err := s.st.AvatarVersions("")
	if err != nil {
		return out
	}
	src := knownFaces{profiles, versions}
	for _, x := range l {
		if !x.Hosted && !x.Bare {
			continue
		}
		st, err := s.m.State(x.ID)
		if err != nil {
			continue
		}
		_, v, _ := avatarIn(src, x.ID, st)
		out[x.ID] = v
		_, v, _ = s.channelFaceIn(src, x.ID, st)
		out["c:"+x.ID] = v
	}
	return out
}

// facesFor is the state "faces" as caller c sees it: the faces of the channels it sees, as
// avatarGet serves them.
func (s *Server) facesFor(c caller, v []byte) []byte {
	if (c.Host() || slices.Contains(s.permsFor(c).Scope, api.PermsAll)) && !s.dms.any() {
		return v
	}
	var m map[string]string
	if json.Unmarshal(v, &m) != nil {
		return v
	}
	seen := map[string]bool{}
	for k := range m {
		id := strings.TrimPrefix(k, "c:")
		ok, known := seen[id]
		if !known {
			st, err := s.m.State(id)
			ok = err == nil && s.seenBy(c, st.Session)
			seen[id] = ok
		}
		if !ok {
			delete(m, k)
		}
	}
	b, _ := json.Marshal(m)
	return b
}
