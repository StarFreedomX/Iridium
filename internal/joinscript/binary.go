package joinscript

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/kumoSleeping/iridium/internal/version"
)

// iridium through this Iridium (the user, 2026-11-17, then for ir-computer): the scripts and a
// connected executor fetch it from <origin>/join/iridium-<os>-<arch>.tar.gz, not from GitHub, so
// the computer reaches one address. This Iridium fetches its own release's from GitHub once, checks
// it against that release's SHA256SUMS and keeps it (Binaries.Dir); a build of no release sends
// the computer to the latest release.
//
// ir-computer-<os>-<arch>[.exe] are served the same way for the lines given out before iridium
// took its place (2026-11-22): to go one release on.

// BinaryPrefix is where the binaries are served.
const BinaryPrefix = "/join/"

var binaryName = regexp.MustCompile(`^iridium-(darwin|linux|windows)-(amd64|arm64)\.tar\.gz$|^ir-computer-(darwin|linux)-(amd64|arm64)$|^ir-computer-windows-(amd64|arm64)\.exe$`)

// BinaryPath reports whether p is one of the binaries.
func BinaryPath(p string) bool {
	name, ok := strings.CutPrefix(p, BinaryPrefix)
	return ok && binaryName.MatchString(name)
}

// ArchiveName is iridium's release archive for goos and goarch (scripts/release.sh): the binary
// iridium (iridium.exe on Windows), README.md and LICENSE.
func ArchiveName(goos, goarch string) string {
	return "iridium-" + goos + "-" + goarch + ".tar.gz"
}

// BinaryName is ir-computer's binary for goos and goarch. To be removed with ir-computer.
func BinaryName(goos, goarch string) string {
	if goos == "windows" {
		return "ir-computer-windows-" + goarch + ".exe"
	}
	return "ir-computer-" + goos + "-" + goarch
}

// Binaries serves the binaries, keeping them in Dir.
type Binaries struct {
	Dir     string
	Version string       // "": version.Version
	Client  *http.Client // nil: one with a long timeout
	Base    string       // the releases; "": GitHub's (tests)

	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func (b *Binaries) version() string {
	if b.Version != "" {
		return b.Version
	}
	return version.Version
}

func (b *Binaries) client() *http.Client {
	if b.Client != nil {
		return b.Client
	}
	return &http.Client{Timeout: 10 * time.Minute}
}

func (b *Binaries) base() string {
	if b.Base != "" {
		return b.Base
	}
	return releases
}

// lock is the lock of one file.
func (b *Binaries) lock(name string) *sync.Mutex {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.locks == nil {
		b.locks = map[string]*sync.Mutex{}
	}
	l := b.locks[name]
	if l == nil {
		l = &sync.Mutex{}
		b.locks[name] = l
	}
	return l
}

// Serve answers GET or HEAD of a BinaryPath.
func (b *Binaries) Serve(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, BinaryPrefix)
	if !BinaryPath(r.URL.Path) || r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	v := b.version()
	if !version.IsRelease(v) {
		http.Redirect(w, r, b.base()+"latest/download/"+name, http.StatusFound)
		return
	}
	// The first fetch goes on for the next one if this one leaves.
	path, err := b.Fetch(context.WithoutCancel(r.Context()), name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	ct := "application/octet-stream"
	if strings.HasSuffix(name, ".tar.gz") {
		ct = "application/gzip"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, name, st.ModTime(), f)
}

// Fetch is the kept file of binary name of this release: fetched from GitHub and checked against
// its SHA256SUMS the first time; the other releases' are dropped then.
func (b *Binaries) Fetch(ctx context.Context, name string) (string, error) {
	v := b.version()
	dir := filepath.Join(b.Dir, v)
	path := filepath.Join(dir, name)
	l := b.lock(name)
	l.Lock()
	defer l.Unlock()
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	tag := "v" + strings.TrimPrefix(v, "v")
	sums, err := b.sums(ctx, tag)
	if err != nil {
		return "", err
	}
	want, ok := sums[name]
	if !ok {
		return "", fmt.Errorf("%s: not in %s's SHA256SUMS", name, tag)
	}
	resp, err := b.get(ctx, b.base()+"download/"+tag+"/"+name)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	tmp, err := os.CreateTemp(dir, name+".*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	sum := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, sum), resp.Body); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if got := hex.EncodeToString(sum.Sum(nil)); got != want {
		return "", fmt.Errorf("%s: sha256 %s, SHA256SUMS says %s", name, got, want)
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return "", err
	}
	// The other releases' are of no use now.
	if ents, err := os.ReadDir(b.Dir); err == nil {
		for _, e := range ents {
			if e.IsDir() && e.Name() != v {
				_ = os.RemoveAll(filepath.Join(b.Dir, e.Name()))
			}
		}
	}
	return path, nil
}

// sums is a release's SHA256SUMS, by file name.
func (b *Binaries) sums(ctx context.Context, tag string) (map[string]string, error) {
	resp, err := b.get(ctx, b.base()+"download/"+tag+"/SHA256SUMS")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	out := map[string]string{}
	sc := bufio.NewScanner(io.LimitReader(resp.Body, 1<<20))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 {
			out[strings.TrimPrefix(f[1], "*")] = f[0]
		}
	}
	return out, sc.Err()
}

func (b *Binaries) get(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := b.client().Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, errors.New(url + ": " + resp.Status)
	}
	return resp, nil
}
