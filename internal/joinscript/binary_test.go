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

// The release's files through the Iridium (proxy): fetched once when first asked and checked
// against SHA256SUMS, kept, the older releases' dropped; SHA256SUMS itself as it is; a build of no
// release sends to the latest.
func TestBinaries(t *testing.T) {
	bin := []byte("the binary")
	sum := sha256.Sum256(bin)
	sums := hex.EncodeToString(sum[:]) + "  iridium-darwin-arm64.tar.gz\n" + strings.Repeat("0", 64) + "  iridium-linux-amd64.tar.gz\n" +
		hex.EncodeToString(sum[:]) + "  iridium-app-darwin-arm64.zip\n"
	fetched := 0
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/download/v1.2.3/SHA256SUMS":
			w.Write([]byte(sums))
		case "/download/v1.2.3/iridium-darwin-arm64.tar.gz", "/download/v1.2.3/iridium-linux-amd64.tar.gz", "/download/v1.2.3/iridium-app-darwin-arm64.zip":
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
		if w := get("/install/iridium-darwin-arm64.tar.gz"); w.Code != 200 || w.Body.String() != string(bin) || w.Header().Get("Content-Type") != "application/gzip" {
			t.Fatalf("%d %q %v", w.Code, w.Body.String(), w.Header())
		}
	}
	if fetched != 1 {
		t.Errorf("fetched %d times", fetched)
	}
	if w := get("/install/iridium-app-darwin-arm64.zip"); w.Code != 200 || w.Header().Get("Content-Type") != "application/zip" {
		t.Fatalf("app: %d %v", w.Code, w.Header())
	}
	if w := get("/install/SHA256SUMS"); w.Code != 200 || w.Body.String() != sums {
		t.Fatalf("sums: %d %q", w.Code, w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "v1.2.2")); !os.IsNotExist(err) {
		t.Error("the older release's kept")
	}
	if w := get("/install/iridium-linux-amd64.tar.gz"); w.Code != http.StatusBadGateway || !strings.Contains(w.Body.String(), "sha256") {
		t.Errorf("a bad sum: %d %s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "v1.2.3", "iridium-linux-amd64.tar.gz")); !os.IsNotExist(err) {
		t.Error("a bad one kept")
	}
	for _, p := range []string{"/install/iridium-plan9-amd64.tar.gz", "/install/../x", "/install/ir-computer-linux-amd64", "/join/iridium-linux-amd64.tar.gz", "/install/iridium-app-linux-amd64.zip"} {
		if w := get(p); w.Code != 404 {
			t.Errorf("%s: %d", p, w.Code)
		}
	}
	b = &Binaries{Dir: dir, Version: "v1.2.4-dev.1+gabc", Base: gh.URL + "/"}
	if w := get("/install/iridium-windows-arm64.tar.gz"); w.Code != http.StatusFound || w.Header().Get("Location") != gh.URL+"/latest/download/iridium-windows-arm64.tar.gz" {
		t.Errorf("no release: %d %v", w.Code, w.Header())
	}
}
