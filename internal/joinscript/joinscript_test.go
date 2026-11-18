package joinscript

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func get(t *testing.T, target, origin string) (int, string) {
	t.Helper()
	w := httptest.NewRecorder()
	Serve(w, httptest.NewRequest(http.MethodGet, target, nil), origin)
	return w.Code, w.Body.String()
}

// The sh line: the address and the options written in as words, the script valid sh; what a
// query carries stays one word.
func TestSh(t *testing.T) {
	code, s := get(t, "/join?shell=0&roots=~/work,~/it's%20mine&name=$(x)", "https://ir.example.com")
	if code != 200 {
		t.Fatalf("%d %s", code, s)
	}
	want := `exec "$exe" 'https://ir.example.com' '--no-shell' '--roots' '~/work,~/it'\''s mine' '--name' '$(x)'`
	if !strings.Contains(s, want+"\n") {
		t.Errorf("no %s in:\n%s", want, s)
	}
	if !strings.Contains(s, `"https://ir.example.com/join/ir-computer-$os-$arch"`) || strings.Contains(s, "{{") {
		t.Errorf("not filled in:\n%s", s)
	}
	if _, err := exec.LookPath("sh"); err == nil {
		f := filepath.Join(t.TempDir(), "join.sh")
		if err := os.WriteFile(f, []byte(s), 0o600); err != nil {
			t.Fatal(err)
		}
		if out, err := exec.Command("sh", "-n", f).CombinedOutput(); err != nil {
			t.Errorf("sh -n: %v %s", err, out)
		}
	}
	// It runs it in the foreground: nothing about login.
	for _, bad := range []string{"--install", "systemctl", "launchctl", "LaunchAgents"} {
		if strings.Contains(s, bad) {
			t.Errorf("has %q", bad)
		}
	}
}

// The PowerShell line: ASCII only, the arguments base64 of UTF-8.
func TestPowerShell(t *testing.T) {
	code, s := get(t, "/join.ps1?roots=C:\\%E5%B7%A5%E4%BD%9C&shell", "http://127.0.0.1:7811")
	if code != 200 {
		t.Fatalf("%d %s", code, s)
	}
	for _, c := range s {
		if c > 0x7e || c < 0x20 && c != '\n' && c != '\r' {
			t.Fatalf("not ASCII: %q", c)
		}
	}
	b64 := func(s string) string { return "'" + base64.StdEncoding.EncodeToString([]byte(s)) + "'" }
	if want := "@(" + b64("http://127.0.0.1:7811") + ", " + b64("--roots") + ", " + b64(`C:\工作`) + ")"; !strings.Contains(s, want) {
		t.Errorf("no %s in:\n%s", want, s)
	}
	if strings.Contains(s, "schtasks") || strings.Contains(s, "{{") {
		t.Errorf("script:\n%s", s)
	}
}

func TestRefused(t *testing.T) {
	for target, origin := range map[string]string{
		"/join?name=a%22b":    "https://ir.example.com", // a quote PowerShell would pass on badly
		"/join?roots=a%0Ab":   "https://ir.example.com",
		"/join":               "https://ir.example.com\n; rm -rf ~",
		"/join.ps1":           "https://x'y",
		"/join/../etc/passwd": "https://ir.example.com",
	} {
		if code, _ := get(t, target, origin); code == 200 {
			t.Errorf("%s from %q: 200", target, origin)
		}
	}
}
