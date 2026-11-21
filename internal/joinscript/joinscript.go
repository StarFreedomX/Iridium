// Package joinscript is the line another computer runs to join this Iridium (docs/exec.md
// "一行命令"): <origin>/join (sh: macOS, Linux) and <origin>/join.ps1 (PowerShell: Windows, from
// cmd too) fetch iridium of this Iridium's version and run it there as an executor of this one
// (iridium serve --no-server --join <origin>), in that terminal, or installed as the user's
// service with the query's install; the options (the query: shell, roots, name, agents) written
// in. <origin>/install and /install.ps1 fetch it the same way and install an Iridium of the
// computer's own (iridium install). Nothing in them is secret: they are served past the gate, and
// the TOKEN comes by pairing.
package joinscript

import (
	"embed"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/kumoSleeping/iridium/internal/version"
)

//go:embed join.sh join.ps1
var files embed.FS

// Paths are the scripts' paths.
var Paths = []string{"/join", "/join.ps1", "/install", "/install.ps1"}

// Path reports whether p is one of them.
func Path(p string) bool {
	switch p {
	case "/join", "/join.ps1", "/install", "/install.ps1":
		return true
	}
	return false
}

// releases is where iridium is published (scripts/release.sh), an archive each system.
const releases = "https://github.com/kumoSleeping/Iridium/releases/"

// want is the version iridium says (iridium version) when it is this Iridium's; "" for a build of
// no release: the latest, fetched each time.
func want() string {
	if !version.Release() {
		return ""
	}
	return "iridium " + version.Version
}

var originRE = regexp.MustCompile(`^https?://[A-Za-z0-9.-]+(:[0-9]+)?$|^https?://\[[0-9A-Fa-f:.]+\](:[0-9]+)?$`)

// Serve answers GET or HEAD of a path Path takes; origin is the Iridium the computer joins.
func Serve(w http.ResponseWriter, r *http.Request, origin string) {
	ps := strings.HasSuffix(r.URL.Path, ".ps1")
	if !Path(r.URL.Path) || r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	origin = strings.TrimRight(origin, "/")
	if !originRE.MatchString(origin) {
		http.Error(w, "bad address", http.StatusBadRequest)
		return
	}
	args, err := Args(r.URL.Path, origin, r.URL.Query())
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

var agentsRE = regexp.MustCompile(`^[a-z0-9_-]+(,[a-z0-9_-]+)*$`)

// Args is iridium's command line for path (Path's): /install an Iridium of the computer's own
// (iridium install); /join an executor of origin (iridium serve --no-server --join origin), with
// the query's install the user's service (iridium install …), and its options: shell=0 (or false:
// no command lines), roots (dir,…; ~ for the home directory), name, agents (a,b: only these
// start there).
func Args(path, origin string, q map[string][]string) ([]string, error) {
	if strings.HasPrefix(path, "/install") {
		return []string{"install"}, nil
	}
	get := func(k string) (string, bool) {
		v, ok := q[k]
		if !ok || len(v) == 0 {
			return "", ok
		}
		return v[0], true
	}
	verb := "serve"
	if v, ok := get("install"); ok && v != "0" && v != "false" {
		verb = "install"
	}
	args := []string{verb, "--no-server", "--join", origin}
	if v, ok := get("shell"); ok && (v == "0" || v == "false") {
		args = append(args, "--no-shell")
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
	if v, _ := get("agents"); v != "" {
		if len(v) > 256 || !agentsRE.MatchString(v) {
			return nil, errors.New("bad agents")
		}
		args = append(args, "--agents", v)
	}
	return args, nil
}

// Script is the script (ps: PowerShell's, else sh's) that runs iridium with args.
func Script(ps bool, origin string, args []string) ([]byte, error) {
	name := "join.sh"
	if ps {
		name = "join.ps1"
	}
	b, err := files.ReadFile(name)
	if err != nil {
		return nil, err
	}
	base, want := origin+BinaryPrefix, want()
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
