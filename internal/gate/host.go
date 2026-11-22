package gate

// The host's own profile (kumo, 2026-11-22): in the desktop app the person at the window is the
// host, and calling them Iridium, with Iridium's mark, clashed with the program. The host may have
// a name and a face of its own; with none it is Iridium, as on any server.

// HostProfile is the host's name and face; all empty: none (Iridium).
type HostProfile struct {
	Name          string
	Avatar        []byte
	AvatarVersion string
}

// HostStore keeps the host's profile (the server's store).
type HostStore interface {
	LoadHost() (HostProfile, error)
	SaveHost(HostProfile) error
}

// HostName is the host's name as shown: its own, else Iridium.
func (g *Gate) HostName() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.hostNameLocked()
}

// HostNamed: has the host a name or a face of its own (then drawn as itself, not as Iridium)?
func (g *Gate) HostNamed() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.host.Name != "" || g.host.AvatarVersion != ""
}

func (g *Gate) hostNameLocked() string {
	if g.host.Name != "" {
		return g.host.Name
	}
	return HostName
}

func (g *Gate) hostInfoLocked() EndpointInfo {
	info := EndpointInfo{ID: HostID, Name: g.hostNameLocked(), Kind: KindChannel}
	if g.host.AvatarVersion != "" {
		info.Avatar = AvatarPrefix + HostID + "?v=" + g.host.AvatarVersion
	}
	return info
}

// isHostNameLocked: is n (a ref) the host's own name?
func (g *Gate) isHostNameLocked(n string) bool {
	return g.host.Name != "" && nameKey(n) == nameKey(g.host.Name)
}

// updateHostLocked is UpdateProfile for the host: a name no app or login has (nor an invite of
// ir_web holds: held), not a reserved one.
func (g *Gate) updateHostLocked(p Profile, avatar []byte, version string, held bool) (EndpointInfo, error) {
	if g.cfg.Host == nil {
		return EndpointInfo{}, ErrLocal
	}
	h := g.host
	if p.Name != nil {
		n, err := NormalizeName(*p.Name)
		if err != nil {
			return EndpointInfo{}, err
		}
		k := nameKey(n)
		for _, e := range g.st.endpoints {
			if nameKey(e.Name) == k {
				return EndpointInfo{}, ErrNameTaken
			}
		}
		if held {
			return EndpointInfo{}, ErrNameTaken
		}
		h.Name = n
	}
	if p.RemoveAvatar {
		h.Avatar, h.AvatarVersion = nil, ""
	}
	if avatar != nil {
		h.Avatar, h.AvatarVersion = avatar, version
	}
	if err := g.cfg.Host.SaveHost(h); err != nil {
		return EndpointInfo{}, err
	}
	g.host = h
	g.log.Info("gate: host profile updated", "name", h.Name, "avatar", h.AvatarVersion != "")
	if g.cfg.OnTerminals != nil {
		go g.cfg.OnTerminals()
	}
	return g.hostInfoLocked(), nil
}
