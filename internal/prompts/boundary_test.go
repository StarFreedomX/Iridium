package prompts_test

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/kumoSleeping/iridium/internal/agent"
	"github.com/kumoSleeping/iridium/internal/ctx/assemble"
)

// The boundary between the layers is the types': what a driver is given is an Injection, which
// only the assembly layer makes.
var (
	_ assemble.Injection                               = agent.Message{}.Text
	_ func(string, assemble.Injection) error           = agent.WriteSystemPrompt
	_ func(assemble.Where) (assemble.Injection, error) = assemble.System
)

const (
	module      = "github.com/kumoSleeping/iridium/"
	promptsPath = module + "internal/prompts"
	assemblyDir = "internal/ctx/assemble"
)

// What the types cannot say, over the code that is not a test:
//   - only the assembly layer reads the text layer: no other package imports internal/prompts,
//     so none can take a fragment's body as a string and hand it on;
//   - nothing but the assembly layer calls assemble.Input, which lets words in as they are (a
//     person's reach a driver through assemble.Message; a driver's test may call it).
func TestBoundary(t *testing.T) {
	t.Parallel()
	root := filepath.Join("..", "..")
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	checked := 0
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			if n := d.Name(); n == "node_modules" || n == "testdata" || (strings.HasPrefix(n, ".") && rel != ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(rel, ".go") || strings.HasSuffix(rel, "_test.go") {
			return nil
		}
		dir := filepath.ToSlash(filepath.Dir(rel))
		if dir == assemblyDir || dir == "internal/prompts" {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		checked++
		f, err := parser.ParseFile(fset, rel, src, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, im := range f.Imports {
			if p, _ := strconv.Unquote(im.Path.Value); p == promptsPath {
				t.Errorf("%s imports internal/prompts: an agent's text is made by %s alone", rel, assemblyDir)
			}
		}
		if strings.Contains(string(src), "assemble.Input(") {
			t.Errorf("%s calls assemble.Input: words reach an agent through assemble.Message", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if checked < 50 {
		t.Fatalf("only %d files looked at: not the repository's root?", checked)
	}
}
