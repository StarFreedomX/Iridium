package joinscript

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// iridium (and ir-computer, for the old lines) through the Iridium: its release's, fetched once
// and checked against SHA256SUMS, kept, the older releases' dropped; a build of no release sends
// to the latest.
func TestBinaries(t *testing.T) {
	bin := []byte("the binary")
	sum := sha256.Sum256(bin)
	sums := hex.EncodeToString(sum[:]) + "  ir-computer-darwin-arm64\n" + strings.Repeat("0", 64) + "  ir-computer-linux-amd64\n" +
		hex.EncodeToString(sum[:]) + "  iridium-windows-arm64.tar.gz\n"
	fetched := 0
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/download/v1.2.3/SHA256SUMS":
			w.Write([]byte(sums))
		case "/download/v1.2.3/ir-computer-darwin-arm64", "/download/v1.2.3/ir-computer-linux-amd64", "/download/v1.2.3/iridium-windows-arm64.tar.gz":
			fetched++
			w.Write(bin)
		default:
			http.NotFound(w, r)
		}
	}))
	defer gh.Close()
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "v1.2.2"), 0o755)
	b := &Binaries{Dir: dir, Version: "v1.2.3", Base: gh.URL + "/"}
	get := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		b.Serve(w, httptest.NewRequest(http.MethodGet, path, nil))
		return w
	}
	for range 2 {
		if w := get("/join/ir-computer-darwin-arm64"); w.Code != 200 || w.Body.String() != string(bin) || w.Header().Get("Content-Length") != "10" {
			t.Fatalf("%d %q %v", w.Code, w.Body.String(), w.Header())
		}
	}
	if fetched != 1 {
		t.Errorf("fetched %d times", fetched)
	}
	if w := get("/join/" + ArchiveName("windows", "arm64")); w.Code != 200 || w.Body.String() != string(bin) || w.Header().Get("Content-Type") != "application/gzip" {
		t.Fatalf("archive: %d %q %v", w.Code, w.Body.String(), w.Header())
	}
	if _, err := os.Stat(filepath.Join(dir, "v1.2.2")); !os.IsNotExist(err) {
		t.Error("the older release's kept")
	}
	if w := get("/join/ir-computer-linux-amd64"); w.Code != http.StatusBadGateway || !strings.Contains(w.Body.String(), "sha256") {
		t.Errorf("a bad sum: %d %s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "v1.2.3", "ir-computer-linux-amd64")); !os.IsNotExist(err) {
		t.Error("a bad one kept")
	}
	for _, p := range []string{"/join/ir-computer-plan9-amd64", "/join/../x", "/join/ir-computer-windows-amd64", "/join/iridium-linux-amd64", "/join/iridium-plan9-amd64.tar.gz"} {
		if w := get(p); w.Code != 404 {
			t.Errorf("%s: %d", p, w.Code)
		}
	}
	b = &Binaries{Dir: dir, Version: "v1.2.4-dev.1+gabc", Base: gh.URL + "/"}
	if w := get("/join/ir-computer-windows-arm64.exe"); w.Code != http.StatusFound || w.Header().Get("Location") != gh.URL+"/latest/download/ir-computer-windows-arm64.exe" {
		t.Errorf("no release: %d %v", w.Code, w.Header())
	}
}
