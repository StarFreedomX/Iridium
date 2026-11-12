package search

import "testing"

func TestTerms(t *testing.T) {
	for in, want := range map[string]string{
		"上下文 ok":     " 上 上下 下 下文 文  ok",
		"改 store.go": " 改  store.go",
		"a/b_c.go":   "a/b_c.go",
	} {
		if got := Terms(in); got != want {
			t.Errorf("Terms(%q) = %q, want %q", in, got, want)
		}
	}
	for in, want := range map[string]string{
		"上下文":           `"上下" "下文"`,
		"权限 Store.go":   `"权限" "store" "go"*`,
		"改":             `"改"`,
		"  ":            "",
		"pass key":      `"pass" "key"*`,
		`a" OR b`:       `"a" "or" "b"*`,
		"internal/chan": `"internal" "chan"*`,
	} {
		if got := Query(in); got != want {
			t.Errorf("Query(%q) = %q, want %q", in, got, want)
		}
	}
}
