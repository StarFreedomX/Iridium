//go:build !windows

package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// cutKey is kv's value when its name is k.
func cutKey(kv, k string) (string, bool) { return strings.CutPrefix(kv, k+"=") }

// LookPath finds the program: absolute as given, a bare name on env's PATH.
func LookPath(program string, env []string) (string, error) {
	if strings.Contains(program, "/") {
		if _, err := os.Stat(program); err != nil {
			return "", fmt.Errorf("%w: %v", ErrNoProgram, err)
		}
		return program, nil
	}
	path := GetEnv(env, "PATH")
	for _, d := range filepath.SplitList(path) {
		if d == "" {
			continue
		}
		p := filepath.Join(d, program)
		if st, err := os.Stat(p); err == nil && !st.IsDir() && st.Mode()&0o111 != 0 {
			return p, nil
		}
	}
	return "", fmt.Errorf("%w: %s on PATH %s", ErrNoProgram, program, path)
}
