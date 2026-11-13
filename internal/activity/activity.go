// Package activity counts what an agent did between two things it said (docs/channels.md
// "活动"): its tool calls, told from the agent's record, by kind. It is all those who do not see
// the agent's record know of its work: how many commands, which files it changed and by how
// many lines; never a command's text, a search's words or a result.
package activity

import (
	"encoding/json"
	"path/filepath"
	"sort"
	"strings"
)

// File is a file the agent changed with an editing tool: Add lines written, Del lines taken out.
// What a shell command changed is not seen here.
type File struct {
	Path string `json:"path"`
	Add  int    `json:"add,omitempty"`
	Del  int    `json:"del,omitempty"`
}

// Activity is what an agent did in a stretch. Bash: shell commands run, Failed of them ending
// badly, Cmds how many began with each program's name; Read: files read or searched; Search and
// Fetch: of the web; Agents: subagents started; Other: other tools; Files: the files changed;
// Ms: from the first call to the words that followed.
type Activity struct {
	Bash   int            `json:"bash,omitempty"`
	Failed int            `json:"failed,omitempty"`
	Cmds   map[string]int `json:"cmds,omitempty"`
	Read   int            `json:"read,omitempty"`
	Search int            `json:"search,omitempty"`
	Fetch  int            `json:"fetch,omitempty"`
	Agents int            `json:"agents,omitempty"`
	Other  int            `json:"other,omitempty"`
	Files  []File         `json:"files,omitempty"`
	Ms     int64          `json:"ms,omitempty"`
	// First: when its first call was (ms), while the stretch is open.
	First int64 `json:"first,omitempty"`
}

// At is a with its files written as at place ("<place>:<path>"): what an agent at another
// machine changed is there, not here. "" leaves it as it is.
func (a Activity) At(place string) Activity {
	if place == "" || len(a.Files) == 0 {
		return a
	}
	files := make([]File, len(a.Files))
	for i, f := range a.Files {
		f.Path = place + ":" + f.Path
		files[i] = f
	}
	a.Files = files
	return a
}

// Empty: nothing was done.
func (a Activity) Empty() bool {
	return a.Bash+a.Read+a.Search+a.Fetch+a.Agents+a.Other+len(a.Files) == 0
}

// Call is a tool call as the records have it: the tool's name as the agent calls it, its input
// as JSON, whether it failed, and when.
type Call struct {
	Name   string
	Input  string
	Failed bool
	At     int64
}

// kinds: a tool's name, lower case, to what it does. The harnesses name the same things
// differently (Claude Code: Bash, Edit; Codex: shell, apply_patch; pi and dsh: bash, edit).
var kinds = map[string]string{
	"bash": "bash", "shell": "bash", "exec_command": "bash", "local_shell": "bash", "shell_command": "bash", "exec": "bash", "container.exec": "bash", "bashoutput": "bash", "unified_exec": "bash",
	"read": "read", "grep": "read", "glob": "read", "ls": "read", "find": "read", "read_file": "read", "list_dir": "read", "grep_files": "read", "view_image": "read", "notebookread": "read",
	"edit": "edit", "multiedit": "edit", "write": "write", "notebookedit": "edit", "str_replace": "edit", "write_file": "write", "create": "write",
	"apply_patch": "patch",
	"websearch":   "search", "web_search": "search", "search": "search",
	"webfetch": "fetch", "web_fetch": "fetch", "fetch": "fetch",
	"agent": "agent", "task": "agent", "spawn_agent": "agent",
}

// Add counts call c into a.
func (a *Activity) Add(c Call) {
	if a.First == 0 {
		a.First = c.At
	}
	var in map[string]any
	_ = json.Unmarshal([]byte(c.Input), &in)
	str := func(keys ...string) string {
		for _, k := range keys {
			if s, ok := in[k].(string); ok && s != "" {
				return s
			}
		}
		return ""
	}
	switch kinds[strings.ToLower(c.Name)] {
	case "bash":
		a.Bash++
		if c.Failed {
			a.Failed++
		}
		cmd := str("command", "cmd")
		if cmd == "" {
			// Codex: the command as a list, often bash -lc "<line>".
			if l, ok := in["command"].([]any); ok {
				var parts []string
				for _, x := range l {
					if s, ok := x.(string); ok {
						parts = append(parts, s)
					}
				}
				if n := len(parts); n >= 3 && strings.HasPrefix(parts[1], "-") && (strings.HasSuffix(parts[0], "sh") || strings.HasSuffix(parts[0], "bash")) {
					cmd = parts[n-1]
				} else {
					cmd = strings.Join(parts, " ")
				}
			}
		}
		if p := Program(cmd); p != "" {
			if a.Cmds == nil {
				a.Cmds = map[string]int{}
			}
			a.Cmds[p]++
		}
	case "read":
		a.Read++
	case "search":
		a.Search++
	case "fetch":
		a.Fetch++
	case "agent":
		a.Agents++
	case "edit":
		path := str("file_path", "path", "notebook_path")
		add, del := lines(str("new_string", "newText", "new_str", "new_source")), lines(str("old_string", "oldText", "old_str"))
		if edits, ok := in["edits"].([]any); ok {
			for _, e := range edits {
				if m, ok := e.(map[string]any); ok {
					n, _ := m["new_string"].(string)
					o, _ := m["old_string"].(string)
					if n == "" && o == "" {
						n, _ = m["newText"].(string)
						o, _ = m["oldText"].(string)
					}
					add, del = add+lines(n), del+lines(o)
				}
			}
		}
		a.file(path, add, del, c.Failed)
	case "write":
		a.file(str("file_path", "path"), lines(str("content", "file_text")), 0, c.Failed)
	case "patch":
		patch := str("input", "patch")
		if patch == "" {
			patch = c.Input // the patch itself, not JSON
		}
		for _, f := range patched(patch) {
			a.file(f.Path, f.Add, f.Del, c.Failed)
		}
	default:
		a.Other++
	}
}

// file counts a change of path; a failed call changed nothing.
func (a *Activity) file(path string, add, del int, failed bool) {
	if failed {
		a.Other++
		return
	}
	if path == "" {
		path = "?"
	}
	for i := range a.Files {
		if a.Files[i].Path == path {
			a.Files[i].Add += add
			a.Files[i].Del += del
			return
		}
	}
	a.Files = append(a.Files, File{Path: path, Add: add, Del: del})
}

// lines is how many lines s has.
func lines(s string) int {
	if s == "" {
		return 0
	}
	return strings.Count(strings.TrimSuffix(s, "\n"), "\n") + 1
}

// patched are the files an apply_patch patch changes, with the lines it adds and takes out.
func patched(patch string) []File {
	var out []File
	for _, l := range strings.Split(patch, "\n") {
		switch {
		case strings.HasPrefix(l, "*** Add File: "), strings.HasPrefix(l, "*** Update File: "), strings.HasPrefix(l, "*** Delete File: "):
			_, p, _ := strings.Cut(l, ": ")
			out = append(out, File{Path: strings.TrimSpace(p)})
		case len(out) == 0 || strings.HasPrefix(l, "***") || strings.HasPrefix(l, "+++") || strings.HasPrefix(l, "---"):
		case strings.HasPrefix(l, "+"):
			out[len(out)-1].Add++
		case strings.HasPrefix(l, "-"):
			out[len(out)-1].Del++
		}
	}
	return out
}

// Program is the name of the program a command line begins with: past what is set before it
// (cd x &&, VAR=value, sudo, env, time), its base name; "" if it has none worth a name. Only
// the name is kept: a command's arguments are the agent's own.
func Program(cmd string) string {
	for _, f := range strings.Fields(strings.NewReplacer("&&", " ", ";", " ", "(", " ").Replace(cmd)) {
		f = strings.Trim(f, `"'`)
		switch {
		case f == "" || f == "sudo" || f == "env" || f == "time" || f == "nohup" || f == "exec" || f == "command" || strings.HasPrefix(f, "-"):
			continue
		case strings.Contains(f, "=") && !strings.HasPrefix(f, "/") && !strings.HasPrefix(f, "."):
			continue // VAR=value
		case f == "cd" || f == "export" || f == "set" || f == "source" || f == ".":
			return skipOne(cmd, f)
		}
		p := filepath.Base(f)
		if len(p) > 24 || strings.ContainsAny(p, "$`{}<>|*?\\") {
			return ""
		}
		return p
	}
	return ""
}

// skipOne is the program of what follows a builtin and its one argument (cd dir && go test).
func skipOne(cmd, builtin string) string {
	_, rest, ok := strings.Cut(cmd, "&&")
	if !ok {
		_, rest, ok = strings.Cut(cmd, ";")
	}
	if !ok {
		return ""
	}
	return Program(rest)
}

// Close ends the stretch at at (ms), when the agent spoke: how long it took.
func (a *Activity) Close(at int64) {
	if a.First > 0 && at > a.First {
		a.Ms = at - a.First
	}
	a.First = 0
}

// Sum adds b to a: a longer stretch's activity.
func (a *Activity) Sum(b Activity) {
	a.Bash += b.Bash
	a.Failed += b.Failed
	a.Read += b.Read
	a.Search += b.Search
	a.Fetch += b.Fetch
	a.Agents += b.Agents
	a.Other += b.Other
	a.Ms += b.Ms
	for k, n := range b.Cmds {
		if a.Cmds == nil {
			a.Cmds = map[string]int{}
		}
		a.Cmds[k] += n
	}
	for _, f := range b.Files {
		a.file(f.Path, f.Add, f.Del, false)
	}
}

// Top are the programs run, the most run first, at most n: "go 4".
func (a Activity) Top(n int) []string {
	type kv struct {
		k string
		n int
	}
	var l []kv
	for k, c := range a.Cmds {
		l = append(l, kv{k, c})
	}
	sort.Slice(l, func(i, j int) bool { return l[i].n > l[j].n || l[i].n == l[j].n && l[i].k < l[j].k })
	var out []string
	for i, x := range l {
		if i >= n {
			break
		}
		out = append(out, x.k+" "+itoa(x.n))
	}
	return out
}

// Lines are the lines added and taken out over all the files changed.
func (a Activity) Lines() (add, del int) {
	for _, f := range a.Files {
		add, del = add+f.Add, del+f.Del
	}
	return add, del
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for ; n > 0; n /= 10 {
		b = append([]byte{byte('0' + n%10)}, b...)
	}
	return string(b)
}
