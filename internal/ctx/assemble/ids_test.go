package assemble

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/kumoSleeping/iridium/internal/prompts"
)

// Every fragment file is named in ids.go and every ID named there is a file; each is used by
// this package's code (not its tests) beyond its declaration, and the code names a fragment
// only through those constants. Other packages cannot reach a fragment at all (internal/prompts'
// boundary test).
func TestFragmentsReferenced(t *testing.T) {
	t.Parallel()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	declared := map[string]string{} // constant -> fragment ID
	used := map[string]int{}        // identifier -> times named outside a declaration
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		names := map[*ast.Ident]bool{}
		ast.Inspect(f, func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.ValueSpec:
				for i, id := range n.Names {
					names[id] = true
					if name != "ids.go" || i >= len(n.Values) {
						continue
					}
					lit, ok := n.Values[i].(*ast.BasicLit)
					if !ok || lit.Kind != token.STRING {
						t.Errorf("ids.go: %s is not a string literal", id.Name)
						continue
					}
					declared[id.Name], _ = strconv.Unquote(lit.Value)
				}
			case *ast.Ident:
				if !names[n] {
					used[n.Name]++
				}
			case *ast.BasicLit:
				// A fragment's ID written out where a constant should be.
				if s, err := strconv.Unquote(n.Value); name != "ids.go" && n.Kind == token.STRING && err == nil {
					if _, ok := prompts.Get(s); ok && strings.Contains(s, ".") {
						t.Errorf("%s: fragment %q named by a literal, not by its constant in ids.go", fset.Position(n.Pos()), s)
					}
				}
			}
			return true
		})
	}
	var ids []string
	for c, id := range declared {
		ids = append(ids, id)
		if used[c] == 0 {
			t.Errorf("fragment %q (%s) is given to no agent: no code uses it", id, c)
		}
		if _, ok := prompts.Get(id); !ok {
			t.Errorf("ids.go names %q (%s): no internal/prompts/texts/%s.md", id, c, id)
		}
	}
	sort.Strings(ids)
	if len(slices.Compact(slices.Clone(ids))) != len(ids) {
		t.Errorf("ids.go names a fragment twice: %v", ids)
	}
	for _, id := range prompts.IDs() {
		if !slices.Contains(ids, id) {
			t.Errorf("internal/prompts/texts/%s.md is named by no code (ids.go)", id)
		}
	}
}
