package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

func TestNewer(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"0.2.0", "0.1.9", true}, {"v1.0.0", "0.9.9", true}, {"0.1.0", "0.1.0", false},
		{"0.1.0", "0.2.0", false}, {"0.1.1", "0.1.0-dev.3+gabc", true}, {"9.9.9", "dev", false}, {"x", "0.1.0", false},
	} {
		if got := newer(c.a, c.b); got != c.want {
			t.Errorf("newer(%q, %q) = %v", c.a, c.b, got)
		}
	}
}

// release serves a signed manifest of version v with one file for linux/amd64, at /app/.
func release(t *testing.T, priv ed25519.PrivateKey, v string, file []byte, tamper func(*Manifest)) *httptest.Server {
	sum := sha256.Sum256(file)
	m := Manifest{App: "ir-app", Version: v, Files: []Artifact{
		{OS: "linux", Arch: "amd64", URL: "ir-app-linux-amd64", Size: int64(len(file)), SHA256: hex.EncodeToString(sum[:])},
	}}
	body, _ := json.Marshal(m)
	sig := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, body))
	if tamper != nil {
		tamper(&m)
		body, _ = json.Marshal(m)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/app/update.json", func(w http.ResponseWriter, _ *http.Request) { w.Write(body) })
	mux.HandleFunc("/app/update.json.sig", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte(sig)) })
	mux.HandleFunc("/app/ir-app-linux-amd64", func(w http.ResponseWriter, _ *http.Request) { w.Write(file) })
	s := httptest.NewServer(mux)
	t.Cleanup(s.Close)
	return s
}

func testSource(t *testing.T, pub ed25519.PublicKey, urls ...string) *source {
	t.Helper()
	old := updateKey
	updateKey = base64.StdEncoding.EncodeToString(pub)
	t.Cleanup(func() { updateKey = old })
	s, err := newSource(func() []string { return urls })
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestCheckAndDownload(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	file := []byte("the new program")
	srv := release(t, priv, "0.2.0", file, nil)
	s := testSource(t, pub, srv.URL+"/app/update.json")
	req := updater.CheckRequest{CurrentVersion: "0.1.0", Platform: "linux", Arch: "amd64"}
	r, err := s.Check(context.Background(), req)
	if err != nil || r == nil {
		t.Fatalf("check: %v %v", r, err)
	}
	if r.Version != "0.2.0" || r.Artifact.Filename != "ir-app-linux-amd64" || r.Metadata["url"] != srv.URL+"/app/ir-app-linux-amd64" {
		t.Fatalf("release: %+v", r)
	}
	var buf bytes.Buffer
	if err := s.Download(context.Background(), r, &buf, nil); err != nil || buf.String() != string(file) {
		t.Fatalf("download: %q %v", buf.String(), err)
	}
	sum := sha256.Sum256(buf.Bytes())
	if !bytes.Equal(sum[:], r.Verification.Digest) {
		t.Fatal("digest")
	}
	// Up to date, or no file for this system: nothing.
	if r, err := s.Check(context.Background(), updater.CheckRequest{CurrentVersion: "0.2.0", Platform: "linux", Arch: "amd64"}); r != nil || err != nil {
		t.Fatalf("same version: %v %v", r, err)
	}
	if r, err := s.Check(context.Background(), updater.CheckRequest{CurrentVersion: "0.1.0", Platform: "darwin", Arch: "arm64"}); r != nil || err != nil {
		t.Fatalf("other system: %v %v", r, err)
	}
}

// A manifest changed after it was signed (its version raised, its sum swapped) or signed by
// another key is not taken; the next source is tried.
func TestManifestMustBeSigned(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(nil)
	_, other, _ := ed25519.GenerateKey(nil)
	req := updater.CheckRequest{CurrentVersion: "0.1.0", Platform: "linux", Arch: "amd64"}
	raised := release(t, priv, "0.0.9", []byte("old"), func(m *Manifest) { m.Version = "9.0.0" })
	foreign := release(t, other, "0.2.0", []byte("evil"), nil)
	if r, err := testSource(t, pub, raised.URL+"/app/update.json").Check(context.Background(), req); r != nil || err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("raised: %v %v", r, err)
	}
	if r, err := testSource(t, pub, foreign.URL+"/app/update.json").Check(context.Background(), req); r != nil || err == nil {
		t.Fatalf("foreign: %v %v", r, err)
	}
	good := release(t, priv, "0.2.0", []byte("new"), nil)
	if r, err := testSource(t, pub, foreign.URL+"/app/update.json", good.URL+"/app/update.json").Check(context.Background(), req); err != nil || r == nil || r.Version != "0.2.0" {
		t.Fatalf("fallback: %v %v", r, err)
	}
}

func TestNoKeyNoUpdates(t *testing.T) {
	old := updateKey
	updateKey = ""
	defer func() { updateKey = old }()
	if _, err := newSource(func() []string { return nil }); err == nil {
		t.Fatal("a build with no key updates")
	}
}

func TestIsServer(t *testing.T) {
	c := Config{Servers: []Server{{URL: "https://ir.kumo.ltd"}, {URL: "http://127.0.0.1:7811"}}}
	for o, want := range map[string]bool{
		"https://ir.kumo.ltd": true, "https://IR.kumo.ltd": true, "http://ir.kumo.ltd": false, "https://ir.kumo.ltd.evil.com": false,
		"http://127.0.0.1:7811": true, "http://127.0.0.1:7810": false, "wails://localhost": false, "": false, "null": false,
	} {
		if got := isServer(c, o); got != want {
			t.Errorf("isServer(%q) = %v", o, got)
		}
	}
}
