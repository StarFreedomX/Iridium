package desktop

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestSetLocal(t *testing.T) {
	var c Config
	c.add("https://ir.example.com")
	c.setLocal("http://127.0.0.1:7810", true)
	if len(c.Servers) != 2 || !c.Servers[0].Local || c.Servers[0].URL != "http://127.0.0.1:7810" || c.current() != "http://127.0.0.1:7810" {
		t.Fatalf("first start: %+v current %q", c.Servers, c.current())
	}
	// Its public address turned on: the entry moves with it, still the one shown.
	c.setLocal("https://me.example.com", false)
	if len(c.Servers) != 2 || c.local().URL != "https://me.example.com" || c.current() != "https://me.example.com" {
		t.Fatalf("moved: %+v current %q", c.Servers, c.current())
	}
	// Another shown: a later start keeps it.
	c.Current = "https://ir.example.com"
	c.setLocal("https://me.example.com", false)
	if c.current() != "https://ir.example.com" {
		t.Fatalf("later start shows %q", c.current())
	}
}

func TestLocalAddress(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	t.Setenv("IRIDIUM_CONFIG", path)
	if a, err := localAddress(); err != nil || a != "http://127.0.0.1:7810" {
		t.Fatalf("default: %q %v", a, err)
	}
	os.WriteFile(path, []byte(`{"listen": "0.0.0.0:7899"}`), 0o600)
	if a, err := localAddress(); err != nil || a != "http://127.0.0.1:7899" {
		t.Fatalf("any address: %q %v", a, err)
	}
	os.WriteFile(path, []byte(`{"listen": "127.0.0.1:7899", "public": {"origin": "https://me.example.com"}}`), 0o600)
	if a, err := localAddress(); err != nil || a != "https://me.example.com" {
		t.Fatalf("public: %q %v", a, err)
	}
}

func TestLoopback(t *testing.T) {
	for a, want := range map[string]bool{
		"http://127.0.0.1:7810": true, "http://localhost:7810": true, "http://[::1]:7810": true,
		"https://ir.example.com": false, "http://192.168.1.2:7810": false,
	} {
		if loopback(a) != want {
			t.Errorf("loopback(%q) = %v", a, !want)
		}
	}
}

// health answers as an Iridium does.
func health() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/_ir/health" {
			w.Write([]byte(`{"ok":true}`))
			return
		}
		http.NotFound(w, r)
	}))
}

func TestEnsureRunning(t *testing.T) {
	srv := health()
	defer srv.Close()
	selfExe = func() (string, error) { t.Fatal("started one while one answers"); return "", nil }
	defer func() { selfExe = os.Executable }()
	var l localState
	if err := l.ensure(context.Background(), srv.URL, t.Logf); err != nil {
		t.Fatal(err)
	}
	if st, _ := l.get(); st != localRunning {
		t.Fatalf("state %q", st)
	}
}

// A daemon that never answers: install and serve are both tried, then it says so.
func TestEnsureFails(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("a shell script stands for the binary")
	}
	dir := t.TempDir()
	log := filepath.Join(dir, "calls")
	exe := filepath.Join(dir, "iridium")
	os.WriteFile(exe, []byte("#!/bin/sh\necho \"$1\" >> "+log+"\nexit 1\n"), 0o755)
	selfExe = func() (string, error) { return exe, nil }
	startWait = 200 * time.Millisecond
	defer func() { selfExe, startWait = os.Executable, 30*time.Second }()
	t.Setenv("IRIDIUM_CONFIG", filepath.Join(dir, "config.json"))
	var l localState
	if err := l.ensure(context.Background(), "http://127.0.0.1:1", t.Logf); err == nil {
		t.Fatal("no error")
	}
	time.Sleep(100 * time.Millisecond) // serve, started apart, writes its line
	b, _ := os.ReadFile(log)
	if got := strings.Fields(string(b)); len(got) != 2 || got[0] != "install" || got[1] != "serve" {
		t.Fatalf("calls %q", got)
	}
	if st, _ := l.get(); st != "未运行" {
		t.Fatalf("state %q", st)
	}
}
