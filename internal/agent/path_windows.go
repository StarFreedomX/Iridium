//go:build windows

package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// cutKey is kv's value when its name is k: Windows names are any case (Path is PATH).
func cutKey(kv, k string) (string, bool) {
	if len(kv) > len(k) && kv[len(k)] == '=' && strings.EqualFold(kv[:len(k)], k) {
		return kv[len(k)+1:], true
	}
	return "", false
}

// LookPath finds the program: a path as given, a bare name on env's PATH, with PATHEXT's
// extensions when it has none (an npm shim is name.cmd).
func LookPath(program string, env []string) (string, error) {
	exts := []string{""}
	if filepath.Ext(program) == "" {
		for _, e := range strings.Split(GetEnv(env, "PATHEXT"), ";") {
			if e != "" {
				exts = append(exts, strings.ToLower(e))
			}
		}
		if len(exts) == 1 {
			exts = append(exts, ".com", ".exe", ".bat", ".cmd")
		}
	}
	find := func(base string) (string, bool) {
		for _, e := range exts {
			if st, err := os.Stat(base + e); err == nil && !st.IsDir() {
				return base + e, true
			}
		}
		return "", false
	}
	if strings.ContainsAny(program, `/\:`) {
		if p, ok := find(program); ok {
			return p, nil
		}
		return "", fmt.Errorf("%w: %s", ErrNoProgram, program)
	}
	path := GetEnv(env, "PATH")
	for _, d := range filepath.SplitList(path) {
		if d == "" {
			continue
		}
		if p, ok := find(filepath.Join(d, program)); ok {
			return p, nil
		}
	}
	return "", fmt.Errorf("%w: %s on PATH %s", ErrNoProgram, program, path)
}
