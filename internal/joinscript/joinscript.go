// Package joinscript is the script that installs ir, Iridium's program, on another computer
// (docs/exec.md "安装"): install.sh (macOS, Linux) and install.ps1 (Windows). It only installs;
// what is given after it runs as ir (sh -s -- start --no-server --join <address>, …). The same
// script two ways:
//
//   - a release's own assets (scripts/release.sh, Render), installing that release from GitHub;
//   - <origin>/install and /install.ps1 of an Iridium (Serve), free of login, installing that
//     Iridium's version from GitHub (a build of no release: the latest), or with the query proxy
//     through this Iridium (<origin>/install/…, Binaries), for a computer that cannot reach GitHub.
//
// Every file is checked in the script against the release's SHA256SUMS. Nothing in it is secret.
package joinscript

import (
	"embed"
	"net/http"
	"regexp"
	"strings"

	"github.com/kumoSleeping/iridium/internal/version"
)

//go:embed install.sh install.ps1
var files embed.FS

// Paths are the scripts' paths on an Iridium.
var Paths = []string{"/install", "/install.ps1"}

// Path reports whether p is one of them.
func Path(p string) bool { return p == "/install" || p == "/install.ps1" }

// Releases is where Iridium is published (scripts/release.sh).
const Releases = "https://github.com/kumoSleeping/Iridium/releases/"

// ReleaseBase is where release v's files are ("": the latest).
func ReleaseBase(v string) string {
	if v == "" {
		return Releases + "latest/download/"
	}
	return Releases + "download/v" + strings.TrimPrefix(v, "v") + "/"
}

var originRE = regexp.MustCompile(`^https?://[A-Za-z0-9.-]+(:[0-9]+)?$|^https?://\[[0-9A-Fa-f:.]+\](:[0-9]+)?$`)

// Serve answers GET or HEAD of a path Path takes; origin is this Iridium as the computer reached it.
func Serve(w http.ResponseWriter, r *http.Request, origin string) {
	if !Path(r.URL.Path) || r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	origin = strings.TrimRight(origin, "/")
	if !originRE.MatchString(origin) {
		http.Error(w, "bad address", http.StatusBadRequest)
		return
	}
	base, release := ReleaseBase(""), "latest"
	if version.Release() {
		base, release = ReleaseBase(version.Version), version.Version
	}
	if proxied(r.URL.Query()) {
		base = origin + BinaryPrefix
	}
	b, err := Render(strings.HasSuffix(r.URL.Path, ".ps1"), base, release, origin)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(b)
}

// proxied: the query asks for the files through this Iridium (proxy, not proxy=0 or false).
func proxied(q map[string][]string) bool {
	v, ok := q["proxy"]
	return ok && (len(v) == 0 || (v[0] != "0" && v[0] != "false"))
}

// Render is the script (ps: PowerShell's, else sh's) installing release from base (where its
// archives and SHA256SUMS are); origin, the Iridium serving it ("": a release's own asset), only
// shows in what it says to do next.
func Render(ps bool, base, release, origin string) ([]byte, error) {
	name := "install.sh"
	if ps {
		name = "install.ps1"
	}
	b, err := files.ReadFile(name)
	if err != nil {
		return nil, err
	}
	// The values sit in single quotes: none may close them.
	clean := func(s string) string { return strings.NewReplacer("'", "", "\n", "", "\r", "").Replace(s) }
	return []byte(strings.NewReplacer(
		"{{BASE}}", clean(base), "{{RELEASE}}", clean(release), "{{ORIGIN}}", clean(origin),
	).Replace(string(b))), nil
}
