package install

import (
	"bytes"
	"encoding/xml"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/kumoSleeping/iridium/internal/config"
)

func TestTaskXML(t *testing.T) {
	x := TaskXML(`C:\Users\a b\AppData\Local\Iridium\iridium.exe`, `C:\Users\a b\AppData\Roaming\Iridium\config.json`, `PC\a&b`)
	var task struct {
		Exec struct {
			Command   string
			Arguments string
		} `xml:"Actions>Exec"`
		User  string `xml:"Principals>Principal>UserId"`
		Limit string `xml:"Settings>ExecutionTimeLimit"`
	}
	// encoding/xml takes no UTF-16 declaration: what schtasks reads is that, re-encoded.
	if err := xml.Unmarshal([]byte(strings.Replace(x, `encoding="UTF-16"`, "", 1)), &task); err != nil {
		t.Fatal(err)
	}
	if task.Exec.Command != `C:\Users\a b\AppData\Local\Iridium\iridium.exe` || task.Exec.Arguments != `serve -config "C:\Users\a b\AppData\Roaming\Iridium\config.json"` {
		t.Fatalf("exec %+v", task.Exec)
	}
	if task.User != `PC\a&b` || task.Limit != "PT0S" {
		t.Fatalf("user %q, limit %q", task.User, task.Limit)
	}
}

func TestInstallTask(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	c := config.Default()
	c.StateDir = filepath.Join(dir, "state")
	if err := c.Save(cfgPath); err != nil {
		t.Fatal(err)
	}
	var ran [][]string
	o := Options{Exe: filepath.Join(dir, "iridium.exe"), ConfigPath: cfgPath, Unit: "iridium-test", Task: true, User: `PC\u`, Now: true,
		Schtasks: func(args ...string) error { ran = append(ran, args); return nil }}
	if err := Install(o); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(c.StateDir, "iridium-test-task.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(b, []byte{0xFF, 0xFE}) || len(b)%2 != 0 {
		t.Fatalf("not UTF-16LE with a BOM: % x", b[:4])
	}
	u := make([]uint16, len(b)/2-1)
	for i := range u {
		u[i] = uint16(b[2+2*i]) | uint16(b[3+2*i])<<8
	}
	if s := string(utf16.Decode(u)); !strings.Contains(s, "<UserId>PC\\u</UserId>\r\n") {
		t.Fatalf("task file: %q", s[:200])
	}
	if len(ran) != 2 || ran[0][0] != "/Create" || ran[1][0] != "/Run" || ran[1][2] != "iridium-test" {
		t.Fatalf("schtasks %q", ran)
	}
}
