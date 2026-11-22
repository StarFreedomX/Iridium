package gate

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

type hostMem struct{ p HostProfile }

func (h *hostMem) LoadHost() (HostProfile, error) { return h.p, nil }
func (h *hostMem) SaveHost(p HostProfile) error   { h.p = p; return nil }

func TestHostProfile(t *testing.T) {
	st, err := OpenJSONStore(filepath.Join(t.TempDir(), "gate.json"))
	if err != nil {
		t.Fatal(err)
	}
	keep := &hostMem{}
	g, err := New(Config{Store: st, Host: keep})
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close()
	// Unset: Iridium, as on any server.
	if e, _ := g.Endpoint(HostID); e.Name != HostName || e.Avatar != "" || g.HostNamed() {
		t.Fatalf("unset: %+v", e)
	}
	if _, err := g.CreateWebLogin("ann"); err != nil {
		t.Fatal(err)
	}
	// A login's name, or a reserved one, is not the host's to take.
	for _, n := range []string{"ann", "Iridium"} {
		if _, err := g.UpdateProfile(HostID, Profile{Name: &n}); err == nil {
			t.Fatalf("host took %q", n)
		}
	}
	n := "kumo"
	if e, err := g.UpdateProfile(HostID, Profile{Name: &n}); err != nil || e.Name != "kumo" {
		t.Fatalf("named: %+v %v", e, err)
	}
	if g.HostName() != "kumo" || !g.HostNamed() || keep.p.Name != "kumo" {
		t.Fatalf("not kept: %q %+v", g.HostName(), keep.p)
	}
	// Found by its name; no login takes it after.
	if e, ok := g.Find("kumo"); !ok || e.ID != HostID {
		t.Fatalf("find: %+v", e)
	}
	if _, err := g.CreateWebLogin("kumo"); !errors.Is(err, ErrNameTaken) {
		t.Fatalf("a login took the host's name: %v", err)
	}
	// Its face, served at the avatar path.
	img := encodePNG(halves(64, 64, 255))
	e, err := g.UpdateProfile(HostID, Profile{Avatar: img})
	if err != nil || e.Avatar == "" {
		t.Fatalf("face: %+v %v", e, err)
	}
	w := httptest.NewRecorder()
	g.serveAvatar(w, httptest.NewRequest(http.MethodGet, "/", nil), HostID)
	if w.Code != http.StatusOK || w.Body.Len() == 0 {
		t.Fatalf("served %d", w.Code)
	}
	// Loaded again, as it was kept.
	g2, err := New(Config{Store: st, Host: keep})
	if err != nil {
		t.Fatal(err)
	}
	defer g2.Close()
	if g2.HostName() != "kumo" || !g2.HostNamed() {
		t.Fatal("not loaded")
	}
}
