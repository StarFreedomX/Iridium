//go:build !windows

package join

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
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

// iridium (executor only) fetches its release archive from the Iridium and takes the binary out.
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
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != joinscript.BinaryPrefix+joinscript.ArchiveName(runtime.GOOS, runtime.GOARCH) {
			http.NotFound(w, r)
			return
		}
		w.Write(buf.Bytes())
	}))
	defer srv.Close()
	dir := t.TempDir()
	exe := filepath.Join(dir, "iridium")
	os.WriteFile(exe, []byte("old"), 0o755)
	o := Options{URL: srv.URL, Out: io.Discard, Prog: Program{Name: "iridium --join", Self: "ir-app", Update: true}}
	if err := o.fetchSelf(context.Background(), exe, "v1.0.1"); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(exe); !bytes.Equal(b, newer) {
		t.Fatalf("in place: %q", b)
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 1 {
		t.Errorf("left beside it: %v", ents)
	}
}

// Connected to an Iridium of another release, ir-computer fetches that one's of itself from it,
// its progress shown, checks it says that version, puts it in place and asks to restart.
func TestUpdate(t *testing.T) {
	newer := []byte("#!/bin/sh\necho 'ir-computer v1.0.1'\n")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != joinscript.BinaryPrefix+joinscript.BinaryName(runtime.GOOS, runtime.GOARCH) {
			http.NotFound(w, r)
			return
		}
		w.Write(newer)
	}))
	defer srv.Close()
	was := version.Version
	version.Version = "v1.0.0"
	defer func() { version.Version = was }()

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
	o.Prog.Update = false
	o.newer(context.Background(), ex, wire.HelloReply{Version: "v1.0.1"}, func() { t.Error("ir join updated itself") })
	select {
	case q := <-asked:
		t.Fatalf("asked %q", q)
	case <-time.After(50 * time.Millisecond):
	}
}
