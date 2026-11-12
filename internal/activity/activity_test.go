package activity

import (
	"reflect"
	"testing"
)

func TestProgram(t *testing.T) {
	for cmd, want := range map[string]string{
		"go test ./...":                          "go",
		"cd ~/ir && go vet ./...":                "go",
		"PATH=$HOME/bin:$PATH FOO=1 npm run x":   "npm",
		"sudo -n systemctl restart x":            "systemctl",
		"/usr/bin/git status":                    "git",
		"export A=1; python3 - <<'EOF'":          "python3",
		"$(which x) y":                           "",
		"cd /tmp":                                "",
		"":                                       "",
		"curl -s -H 'Authorization: Bearer abc'": "curl",
	} {
		if got := Program(cmd); got != want {
			t.Errorf("%q: %q, want %q", cmd, got, want)
		}
	}
}

func TestActivity(t *testing.T) {
	var a Activity
	for _, c := range []Call{
		{Name: "Bash", Input: `{"command":"go test ./..."}`, At: 1000},
		{Name: "Bash", Input: `{"command":"cd x && go vet"}`, Failed: true},
		{Name: "shell", Input: `{"command":["bash","-lc","git status"]}`},
		{Name: "Read", Input: `{"file_path":"/a.go"}`},
		{Name: "Grep", Input: `{"pattern":"x"}`},
		{Name: "Edit", Input: `{"file_path":"/a.go","old_string":"a\nb","new_string":"a\nb\nc\n"}`},
		{Name: "Edit", Input: `{"file_path":"/a.go","old_string":"x","new_string":""}`},
		{Name: "Write", Input: `{"file_path":"/b.go","content":"1\n2\n"}`},
		{Name: "Write", Input: `{"file_path":"/c.go","content":"1"}`, Failed: true},
		{Name: "apply_patch", Input: `{"input":"*** Begin Patch\n*** Update File: d.go\n@@\n-old\n+new\n+more\n*** Add File: e.go\n+x\n*** End Patch"}`},
		{Name: "WebSearch", Input: `{"query":"secret words"}`},
		{Name: "WebFetch", Input: `{"url":"https://x"}`},
		{Name: "Agent", Input: `{}`},
		{Name: "mcp__thing__do", Input: `{}`},
	} {
		a.Add(c)
	}
	a.Close(5000)
	want := Activity{Bash: 3, Failed: 1, Cmds: map[string]int{"go": 2, "git": 1}, Read: 2, Search: 1, Fetch: 1, Agents: 1, Other: 2, Ms: 4000,
		Files: []File{{"/a.go", 3, 3}, {"/b.go", 2, 0}, {"d.go", 2, 1}, {"e.go", 1, 0}}}
	if !reflect.DeepEqual(a, want) {
		t.Fatalf("got  %+v\nwant %+v", a, want)
	}
	if top := a.Top(1); len(top) != 1 || top[0] != "go 2" {
		t.Errorf("top: %v", top)
	}
	var sum Activity
	sum.Sum(a)
	sum.Sum(a)
	if add, del := sum.Lines(); sum.Bash != 6 || len(sum.Files) != 4 || add != 16 || del != 8 || sum.Cmds["go"] != 4 {
		t.Errorf("sum: %+v", sum)
	}
	if !(Activity{}).Empty() || a.Empty() {
		t.Error("empty")
	}
}
