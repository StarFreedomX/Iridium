//go:build !windows

package join

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/kumoSleeping/iridium/internal/joinscript"
	"github.com/kumoSleeping/iridium/internal/remote/executor"
	"github.com/kumoSleeping/iridium/internal/remote/wire"
	"github.com/kumoSleeping/iridium/internal/version"
)

// sumsOf is a SHA256SUMS of these files.
func sumsOf(files map[string][]byte) []byte {
	var b strings.Builder
	for name, f := range files {
		s := sha256.Sum256(f)
		b.WriteString(hex.EncodeToString(s[:]) + "  " + name + "\n")
	}
	return []byte(b.String())
}

// iridium (executor only) fetches its release archive from GitHub, or with Proxy through the
// Iridium, checks it against SHA256SUMS and takes the binary out; one that does not match is not
// put in place.
func TestUpdateArchive(t *testing.T) {
	newer := []byte("#!/bin/sh\necho 'iridium v1.0.1'\n")
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, f := range []struct {
		name string
		b    []byte
	}{{"./README.md", []byte("readme")}, {"./" + binaryIn(runtime.GOOS), newer}} {
		tw.WriteHeader(&tar.Header{Name: f.name, Mode: 0o755, Size: int64(len(f.b)), Typeflag: tar.TypeReg})
		tw.Write(f.b)
	}
	tw.Close()
	gz.Close()
	archive := joinscript.ArchiveName(runtime.GOOS, runtime.GOARCH)
	sums := sumsOf(map[string][]byte{archive: buf.Bytes()})
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/gh/v1.0.1/"), joinscript.BinaryPrefix) {
		case "SHA256SUMS":
			w.Write(sums)
		case archive:
			w.Write(buf.Bytes())
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	was := releases
	releases = func(v string) string { return srv.URL + "/gh/" + v + "/" }
	defer func() { releases = was }()
	for _, proxy := range []bool{false, true} {
		paths = nil
		dir := t.TempDir()
		exe := filepath.Join(dir, "iridium")
		os.WriteFile(exe, []byte("old"), 0o755)
		o := Options{URL: srv.URL, Out: io.Discard, Proxy: proxy, Prog: Program{Name: "iridium --join", Self: "ir-app", Update: true}}
		if err := o.fetchSelf(context.Background(), exe, "v1.0.1"); err != nil {
			t.Fatal(proxy, err)
		}
		if b, _ := os.ReadFile(exe); !bytes.Equal(b, newer) {
			t.Fatalf("in place: %q", b)
		}
		if ents, _ := os.ReadDir(dir); len(ents) != 1 {
			t.Errorf("left beside it: %v", ents)
		}
		want := "/gh/v1.0.1/" + archive
		if proxy {
			want = joinscript.BinaryPrefix + archive
		}
		if len(paths) != 2 || paths[1] != want {
			t.Errorf("proxy %v fetched %v", proxy, paths)
		}
	}
	sums = sumsOf(map[string][]byte{archive: []byte("another")})
	exe := filepath.Join(t.TempDir(), "iridium")
	os.WriteFile(exe, []byte("old"), 0o755)
	o := Options{URL: srv.URL, Out: io.Discard, Prog: Program{Name: "iridium --join", Self: "ir-app", Update: true}}
	if err := o.fetchSelf(context.Background(), exe, "v1.0.1"); err == nil || !strings.Contains(err.Error(), "SHA256SUMS") {
		t.Fatalf("a bad sum: %v", err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "old" {
		t.Fatalf("a bad one in place: %q", b)
	}
}

// Connected to an Iridium of another release, ir-computer fetches that one's of itself (GitHub),
// its progress shown, checks it says that version, puts it in place and asks to restart.
func TestUpdate(t *testing.T) {
	newer := []byte("#!/bin/sh\necho 'ir-computer v1.0.1'\n")
	file := "ir-computer-" + runtime.GOOS + "-" + runtime.GOARCH
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/gh/" + file:
			w.Write(newer)
		case "/gh/SHA256SUMS":
			w.Write(sumsOf(map[string][]byte{file: newer}))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	was := releases
	releases = func(string) string { return srv.URL + "/gh/" }
	defer func() { releases = was }()
	wasV := version.Version
	version.Version = "v1.0.0"
	defer func() { version.Version = wasV }()

	exe := filepath.Join(t.TempDir(), "ir-computer")
	os.WriteFile(exe, []byte("old"), 0o755)
	var out bytes.Buffer
	o := Options{URL: srv.URL, Out: &out, Prog: Program{Name: "ir-computer", Self: "ir-computer", Update: true}}
	if err := o.fetchSelf(context.Background(), exe, "v1.0.1"); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); !bytes.Equal(b, newer) {
		t.Fatalf("in place: %q", b)
	}
	if s := out.String(); !strings.Contains(s, "下载中 100%") || !strings.Contains(s, "下载完成") {
		t.Errorf("progress: %q", s)
	}
	if _, err := os.Stat(exe + ".new"); !os.IsNotExist(err) {
		t.Error("the download left")
	}
	// One that says another version is not put in place.
	if err := o.fetchSelf(context.Background(), exe, "v1.0.2"); err == nil || !strings.Contains(err.Error(), "not ir-computer v1.0.2") {
		t.Fatalf("another version: %v", err)
	}

	// By the hello's answer, nothing for the same version, a build of no release, or ir join (the
	// rest replaces where this test runs from: fetchSelf above).
	ex, err := executor.New(executor.Options{State: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	asked := make(chan string, 1)
	o.Ask = func(_ context.Context, q string) bool { asked <- q; return true }
	o.newer(context.Background(), ex, wire.HelloReply{Version: "v1.0.0"}, func() { t.Error("restart for the same version") })
	o.newer(context.Background(), ex, wire.HelloReply{Version: "1.0.1-dev.2"}, func() { t.Error("restart for a build of no release") })
	// Up only: an Iridium of an older release does not take this one back (2026-11-23).
	o.newer(context.Background(), ex, wire.HelloReply{Version: "v0.9.9"}, func() { t.Error("restart for an older release") })
	o.Prog.Update = false
	o.newer(context.Background(), ex, wire.HelloReply{Version: "v1.0.1"}, func() { t.Error("ir join updated itself") })
	select {
	case q := <-asked:
		t.Fatalf("asked %q", q)
	case <-time.After(50 * time.Millisecond):
	}
}
