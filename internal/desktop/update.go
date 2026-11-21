package desktop

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/version"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

// The app's update (docs/app.md "更新"): Iridium's releases, the app's files among them; this
// computer's own Iridium updates itself (internal/update). A release's app files are in a
// manifest, update.json, signed whole with the app's key (update.json.sig, ed25519, base64): its
// version and each file's SHA-256, so neither a file nor an older release can be passed off by
// whoever serves them. Fetched from each Iridium it is joined to (which fetches it from GitHub),
// then from GitHub itself.

// updateKey is the release key's public half, base64, set by the build (-ldflags -X): none, no
// updates (a build from source).
var updateKey = ""

// githubManifest is where the app's releases are on GitHub: Iridium's latest, the app's files
// and the manifest among its assets (scripts/app-bundle.sh).
const githubManifest = "https://github.com/kumoSleeping/Iridium/releases/latest/download/update.json"

// Manifest is update.json.
type Manifest struct {
	App       string     `json:"app"` // "ir-app": a manifest of something else is not taken
	Version   string     `json:"version"`
	Notes     string     `json:"notes,omitempty"`
	Published time.Time  `json:"published"`
	Files     []Artifact `json:"files"`
}

// Artifact is a release's file for one system: a URL relative to the manifest's, or whole.
type Artifact struct {
	OS     string `json:"os"`
	Arch   string `json:"arch"`
	URL    string `json:"url"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// source fetches and checks the manifests: an updater.Provider.
type source struct {
	key  ed25519.PublicKey
	urls func() []string // the manifests' addresses, tried in order
	http *http.Client
}

func newSource(urls func() []string) (*source, error) {
	k, err := base64.StdEncoding.DecodeString(updateKey)
	if err != nil || len(k) != ed25519.PublicKeySize {
		return nil, errors.New("this build has no release key: no updates")
	}
	return &source{key: k, urls: urls, http: &http.Client{Timeout: 10 * time.Minute}}, nil
}

func (s *source) Name() string { return "ir-app" }

// Check is the newest release for this system, if newer than this one.
func (s *source) Check(ctx context.Context, req updater.CheckRequest) (*updater.Release, error) {
	var errs []error
	for _, u := range s.urls() {
		m, err := s.manifest(ctx, u)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", u, err))
			continue
		}
		if !newer(m.Version, req.CurrentVersion) {
			return nil, nil
		}
		for _, f := range m.Files {
			if f.OS != req.Platform || f.Arch != req.Arch {
				continue
			}
			sum, err := hex.DecodeString(f.SHA256)
			if err != nil || len(sum) != 32 {
				return nil, fmt.Errorf("%s: bad sha256 for %s/%s", u, f.OS, f.Arch)
			}
			ref, err := url.Parse(f.URL)
			if err != nil {
				return nil, err
			}
			base, _ := url.Parse(u)
			whole := base.ResolveReference(ref)
			name := whole.Path[strings.LastIndexByte(whole.Path, '/')+1:]
			return &updater.Release{
				Version: m.Version, Notes: m.Notes, PublishedAt: m.Published,
				Artifact:     updater.Artifact{Filename: name, Size: f.Size, Platform: f.OS, Arch: f.Arch},
				Verification: &updater.Verification{DigestAlgo: "sha256", Digest: sum},
				Metadata:     map[string]any{"url": whole.String()},
			}, nil
		}
		return nil, nil // newer, but not for this system
	}
	return nil, errors.Join(errs...)
}

// manifest is the one at u, its signature checked.
func (s *source) manifest(ctx context.Context, u string) (*Manifest, error) {
	body, err := s.get(ctx, u, 1<<20)
	if err != nil {
		return nil, err
	}
	sig, err := s.get(ctx, u+".sig", 1<<10)
	if err != nil {
		return nil, err
	}
	return verifyManifest(s.key, body, sig)
}

// verifyManifest is body as a manifest, if sig (base64) is the key's signature of it.
func verifyManifest(key ed25519.PublicKey, body, sig []byte) (*Manifest, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sig)))
	if err != nil || !ed25519.Verify(key, body, raw) {
		return nil, errors.New("the manifest's signature does not verify")
	}
	var m Manifest
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, err
	}
	if m.App != "ir-app" {
		return nil, fmt.Errorf("a manifest of %q, not ir-app", m.App)
	}
	return &m, nil
}

func (s *source) get(ctx context.Context, u string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	res, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s", res.Status)
	}
	return io.ReadAll(io.LimitReader(res.Body, limit))
}

// Download streams the release's file; the updater checks it against the manifest's sum.
func (s *source) Download(ctx context.Context, r *updater.Release, dst io.Writer, progress func(written, total int64)) error {
	u, _ := r.Metadata["url"].(string)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	res, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: %s", u, res.Status)
	}
	total := cmpOr(res.ContentLength, r.Artifact.Size)
	var n int64
	buf := make([]byte, 64<<10)
	for {
		k, err := res.Body.Read(buf)
		if k > 0 {
			if _, werr := dst.Write(buf[:k]); werr != nil {
				return werr
			}
			n += int64(k)
			if progress != nil {
				progress(n, total)
			}
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func cmpOr(a, b int64) int64 {
	if a > 0 {
		return a
	}
	return b
}

// newer: is a a later version than b (major.minor.patch, a leading v and what follows a - or +
// in b aside)? A b that is no release (dev) is never older: a build from source is not updated.
func newer(a, b string) bool {
	pa, oka := semver(a)
	pb, okb := semver(b)
	if !oka || !okb {
		return false
	}
	for i := range 3 {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return false
}

func semver(v string) ([3]int, bool) {
	var out [3]int
	v = strings.TrimPrefix(v, "v")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

// manifestURLs are where a release is looked for: each Iridium in the list, then GitHub.
func manifestURLs(c Config) []string {
	var out []string
	for _, s := range c.Servers {
		out = append(out, s.URL+"/app/update.json")
	}
	return append(out, githubManifest)
}

// updaterConfig is the updater's for this program.
func updaterConfig(src *source, every time.Duration) updater.Config {
	return updater.Config{
		CurrentVersion: strings.TrimPrefix(version.Version, "v"),
		Providers:      []updater.Provider{src},
		CheckInterval:  every,
		Platform:       runtime.GOOS,
		Arch:           runtime.GOARCH,
		Window:         updater.WindowNone,
	}
}
