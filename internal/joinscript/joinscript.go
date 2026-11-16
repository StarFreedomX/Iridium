// Package joinscript is the line another computer runs to join this Iridium (docs/exec.md
// "ir-computer"): <origin>/join (sh: macOS, Linux) and <origin>/join.ps1 (PowerShell: Windows,
// from cmd too) fetch ir-computer of this Iridium's version and run it in that terminal, the
// address and the options (the query: shell, roots, name) written in. Nothing in them is secret:
// they are served past the gate, and the TOKEN comes by pairing.
package joinscript

import (
	"embed"
	"encoding/base64"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/kumoSleeping/iridium/internal/version"
)

//go:embed join.sh join.ps1
var files embed.FS

// Paths are the scripts' paths.
var Paths = []string{"/join", "/join.ps1"}

// Path reports whether p is one of them.
func Path(p string) bool { return p == "/join" || p == "/join.ps1" }

// releases is where ir-computer is published (scripts/release.sh), a bare binary each system.
const releases = "https://github.com/kumoSleeping/Iridium/releases/"

// download is the release ir-computer is fetched from, and the version it says (ir-computer
// version) when it is that one: this Iridium's; a build of no release takes the latest, fetched
// each time.
func download() (base, want string) {
	if !version.Release() {
		return releases + "latest/download/", ""
	}
	tag := "v" + strings.TrimPrefix(version.Version, "v")
	return releases + "download/" + tag + "/", "ir-computer " + version.Version
}

var originRE = regexp.MustCompile(`^https?://[A-Za-z0-9.-]+(:[0-9]+)?$|^https?://\[[0-9A-Fa-f:.]+\](:[0-9]+)?$`)

// Serve answers GET or HEAD of a path Path takes; origin is the Iridium the computer joins.
func Serve(w http.ResponseWriter, r *http.Request, origin string) {
	ps := r.URL.Path == "/join.ps1"
	if !Path(r.URL.Path) || r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	origin = strings.TrimRight(origin, "/")
	if !originRE.MatchString(origin) {
		http.Error(w, "bad address", http.StatusBadRequest)
		return
	}
	args, err := Args(origin, r.URL.Query())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	b, err := Script(ps, origin, args)
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

// Args is ir-computer's command line from the query: shell (present, not 0 or false), roots
// (dir,…; ~ for the home directory), name.
func Args(origin string, q map[string][]string) ([]string, error) {
	get := func(k string) (string, bool) {
		v, ok := q[k]
		if !ok || len(v) == 0 {
			return "", ok
		}
		return v[0], true
	}
	args := []string{origin}
	if v, ok := get("shell"); ok && v != "0" && v != "false" {
		args = append(args, "--shell")
	}
	for _, k := range []string{"roots", "name"} {
		v, _ := get(k)
		if v == "" {
			continue
		}
		if len(v) > 1024 || strings.ContainsAny(v, "\"\x00\r\n") || strings.IndexFunc(v, func(c rune) bool { return c < 0x20 || c == 0x7f }) >= 0 {
			return nil, fmt.Errorf("bad %s", k)
		}
		args = append(args, "--"+k, v)
	}
	return args, nil
}

// Script is the script (ps: PowerShell's, else sh's) that runs ir-computer with args.
func Script(ps bool, origin string, args []string) ([]byte, error) {
	name := "join.sh"
	if ps {
		name = "join.ps1"
	}
	b, err := files.ReadFile(name)
	if err != nil {
		return nil, err
	}
	base, want := download()
	words := make([]string, len(args))
	for i, a := range args {
		if ps {
			words[i] = "'" + base64.StdEncoding.EncodeToString([]byte(a)) + "'"
		} else {
			words[i] = shQuote(a)
		}
	}
	sep, wantWord := " ", shQuote(want)
	if ps {
		sep, wantWord = ", ", want
	}
	return []byte(strings.NewReplacer(
		"{{ORIGIN}}", origin, "{{DOWNLOAD}}", base, "{{WANT}}", wantWord, "{{ARGS}}", strings.Join(words, sep),
	).Replace(string(b))), nil
}

// shQuote is s as one word of sh.
func shQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }
