package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/config"
	"github.com/kumoSleeping/iridium/internal/files"
	"github.com/kumoSleeping/iridium/internal/gate"
	"github.com/kumoSleeping/iridium/internal/remote"
	"github.com/kumoSleeping/iridium/internal/remote/executor"
	"github.com/kumoSleeping/iridium/internal/remote/wire"
)

// Web file browsing: list a folder, read a Range slice, honor the host guard, refuse app tokens.
func TestFileBrowserAccess(t *testing.T) {
	t.Parallel()
	l := start(t)
	const route = "/v1/internal/web/files"
	const name = "some notes.txt"
	path := filepath.Join(l.work, name)
	if err := os.WriteFile(path, []byte("preview content"), 0o600); err != nil {
		t.Fatal(err)
	}
	list := route + "?path=" + url.QueryEscape(l.work)
	content := route + "/content?path=" + url.QueryEscape(path)

	var listing api.DirListing
	l.want(http.StatusOK, "web", "GET", list, nil, &listing)
	if len(listing.Entries) != 1 || listing.Entries[0].Name != name || listing.Entries[0].Type != "file" {
		t.Fatalf("unexpected directory listing: %+v", listing)
	}
	var body string
	status := l.doWith("web", "GET", content, nil, &body, http.Header{"Range": {"bytes=0-6"}})
	if status != http.StatusPartialContent || body != "preview" {
		t.Fatalf("ranged preview: got %d, %q", status, body)
	}

	// The host file guard still applies, and an app token is refused.
	l.want(http.StatusForbidden, "web", "GET", route+"?path="+url.QueryEscape(l.cfg.StatePath()), nil, nil)
	private := filepath.Join(l.cfg.StatePath(), name)
	if err := os.WriteFile(private, []byte("private file"), 0o600); err != nil {
		t.Fatal(err)
	}
	l.want(http.StatusForbidden, "web", "GET", route+"/content?path="+url.QueryEscape(private), nil, nil)
	app := l.newApp("browse", false)
	l.want(http.StatusForbidden, app.Token, "GET", list, nil, nil)
	l.want(http.StatusForbidden, app.Token, "GET", content, nil, nil)
}

// A login can browse folders within both its scope and the computer's shared roots.
// A grant at one computer does not grant the same path at another.
func TestFileBrowserScope(t *testing.T) {
	t.Parallel()
	const name = "note.txt"
	const content = "preview content"
	hub := &remote.Hub{}
	l := startWith(t, func(s *Server, _ config.Config, _ string) { s.Remote = hub; s.WatchMachines() })
	here := filepath.Join(l.work, "here")
	shared := filepath.Join(l.work, "shared")
	there := filepath.Join(shared, "there")
	sibling := filepath.Join(shared, "sibling")
	for _, dir := range []string{here, there, sibling} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	tok := l.newApp("pc", false)
	exe, err := executor.New(executor.Options{
		URL:   "ws" + strings.TrimPrefix(l.base, "http") + "/v1/internal/exec",
		Token: tok.Token, State: t.TempDir(), Roots: []string{shared}, Logf: t.Logf,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { _ = exe.Run(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done; exe.Close() })
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(20 * time.Millisecond) {
		if _, ok := hub.Machine(tok.App.ID).Hello(); ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("no executor")
		}
	}

	login, err := l.s.gate().CreateWebLogin("files-guest")
	if err != nil {
		t.Fatal(err)
	}
	l.want(http.StatusOK, "socket", http.MethodPut, "/v1/internal/apps/"+gate.WebApp+"/logins/"+login.ID+"/perms", api.Perms{
		Scope: []string{here, "pc:" + there, "pc:" + here},
	}, nil)
	c := caller{Identity: gate.Identity{App: gate.WebApp, Login: login.ID}}
	mux := http.NewServeMux()
	l.s.fileRoutes(mux, false)
	req := func(t *testing.T, route, machine, path string, want int) *httptest.ResponseRecorder {
		t.Helper()
		raw := "/v1/internal/web/files" + route + "?" + url.Values{"machine": {machine}, "path": {path}}.Encode()
		r := httptest.NewRequest(http.MethodGet, raw, nil)
		if route == "/content" {
			r.Header.Set("Range", "bytes=0-6")
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), callerKey{}, c)))
		if w.Code != want {
			t.Fatalf("%s: got %d, want %d (%s)", raw, w.Code, want, w.Body)
		}
		return w
	}
	for machine, dir := range map[string]string{"": here, "pc": there} {
		w := req(t, "", machine, "", http.StatusOK)
		var list api.DirListing
		if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
			t.Fatalf("listing at %q: %v", machine, err)
		}
		if filepath.FromSlash(list.Path) != dir || len(list.Entries) != 1 || list.Entries[0].Name != name {
			t.Fatalf("starting folder at %q: %+v, want %s with %s", machine, list, dir, name)
		}
		if w := req(t, "/content", machine, filepath.Join(dir, name), http.StatusPartialContent); w.Body.String() != content[:7] {
			t.Fatalf("preview at %q: %q", machine, w.Body)
		}
	}
	req(t, "", "", there, http.StatusForbidden)
	req(t, "/content", "", filepath.Join(there, name), http.StatusForbidden)
	req(t, "", "pc", here, http.StatusForbidden) // The login has it, the computer does not share it.
	req(t, "/content", "pc", filepath.Join(sibling, name), http.StatusForbidden)
	req(t, "", "pc", there+string(filepath.Separator)+".."+string(filepath.Separator)+"sibling", http.StatusForbidden)
	t.Run("symlink", func(t *testing.T) {
		link := filepath.Join(there, "linked")
		if err := os.Symlink(sibling, link); err != nil {
			t.Skipf("no directory links: %v", err)
		}
		req(t, "", "pc", link, http.StatusForbidden)
		req(t, "/content", "pc", filepath.Join(link, name), http.StatusForbidden)
	})
	t.Run("hidden paths", func(t *testing.T) {
		for machine, root := range map[string]string{"": here, "pc": there} {
			dir := filepath.Join(root, "project")
			dot := filepath.Join(dir, ".hidden")
			if err := os.MkdirAll(dot, 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dot, name), []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			dotFile := filepath.Join(dir, ".private")
			if err := os.WriteFile(dotFile, []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			w := req(t, "", machine, dir, http.StatusOK)
			var list api.DirListing
			if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
				t.Fatal(err)
			}
			for _, entry := range list.Entries {
				if entry.Name == filepath.Base(dot) || entry.Name == filepath.Base(dotFile) {
					t.Errorf("browser at %q listed hidden entry %q", machine, entry.Name)
				}
			}
			req(t, "", machine, dot, http.StatusForbidden)
			req(t, "/content", machine, filepath.Join(dot, name), http.StatusForbidden)
			req(t, "/content", machine, dotFile, http.StatusForbidden)
			t.Run("alias "+dir, func(t *testing.T) {
				link := filepath.Join(dir, "alias")
				if err := os.Symlink(dot, link); err != nil {
					t.Skipf("no directory links: %v", err)
				}
				req(t, "", machine, link, http.StatusForbidden)
				req(t, "/content", machine, filepath.Join(link, name), http.StatusForbidden)
			})
		}
		// Other executor callers retain their own permissions.
		if _, err := hub.Machine(tok.App.ID).ReadAt(ctx, filepath.Join(there, "project", ".hidden", name), 0, 1); err != nil {
			t.Fatalf("ordinary executor read: %v", err)
		}
	})
}

// A Windows executor receives "/" verbatim for browser listings, with the login scope still
// attached. File content never sends that virtual path to the executor.
func TestFileBrowserWindowsRemoteRoot(t *testing.T) {
	t.Parallel()
	hub := &remote.Hub{}
	l := startWith(t, func(s *Server, _ config.Config, _ string) { s.Remote = hub })
	app := l.newApp("win-pc", false)
	exec := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.Serve(w, r, app.App.ID, app.App.Name)
	}))
	defer exec.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(exec.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	conn := wire.NewConn(ws)
	defer conn.Close()
	calls := make(chan testBrowserDriveCall, 2)
	conn.OnRequest = func(_ context.Context, method string, raw json.RawMessage) (any, error) {
		var p wire.PathParams
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, err
		}
		calls <- testBrowserDriveCall{method, p}
		return wire.ListReply{Entries: []wire.Entry{{Name: "D:", Type: "dir"}}}, nil
	}
	go conn.Run(ctx)
	hi := wire.Hello{Protocol: wire.Protocol, OS: "windows", Sep: `\`, Home: `C:\Users\example`}
	if err := conn.Call(ctx, "hello", hi, &wire.HelloReply{}); err != nil {
		t.Fatal(err)
	}
	for {
		if _, ok := hub.Machine(app.App.ID).Hello(); ok {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("no executor")
		case <-time.After(10 * time.Millisecond):
		}
	}
	login, err := l.s.gate().CreateWebLogin("win-guest")
	if err != nil {
		t.Fatal(err)
	}
	l.want(http.StatusOK, "socket", http.MethodPut, "/v1/internal/apps/"+gate.WebApp+"/logins/"+login.ID+"/perms", api.Perms{
		Scope: []string{app.App.ID + ":D:/project"},
	}, nil)

	q := "?" + url.Values{"machine": {app.App.ID}, "path": {"/"}}.Encode()
	c := caller{Identity: gate.Identity{App: gate.WebApp, Login: login.ID}}
	request := func(route string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, route+q, nil)
		w := httptest.NewRecorder()
		mux := http.NewServeMux()
		l.s.fileRoutes(mux, false)
		mux.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), callerKey{}, c)))
		return w
	}
	w := request("/v1/internal/web/files")
	var got api.DirListing
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || w.Code != http.StatusOK ||
		got.Path != "/" || len(got.Entries) != 1 || got.Entries[0].Name != "D:" || got.Entries[0].Type != "dir" {
		t.Fatalf("listing: status %d, body %s, decode %v", w.Code, w.Body, err)
	}
	call := <-calls
	if call.method != "fs.list.browser" || call.params.Path != "/" || !slices.Equal(call.params.Scope, []string{`D:\project`}) {
		t.Fatalf("unexpected executor call: %+v", call)
	}
	if w := request("/v1/internal/web/files/content"); w.Code != http.StatusBadRequest {
		t.Fatalf("virtual root content: %d %s", w.Code, w.Body)
	}
	select {
	case call := <-calls:
		t.Fatalf("virtual root content was forwarded: %+v", call)
	default:
	}
}

type testBrowserDriveCall struct {
	method string
	params wire.PathParams
}

func TestFileBrowserWindowsHostRoot(t *testing.T) {
	if filepath.Separator != '\\' {
		t.Skip("Windows host only")
	}
	s := &Server{files: &files.Service{}}
	mux := http.NewServeMux()
	s.fileRoutes(mux, false)
	const route = "/v1/internal/web/files"
	request := func(suffix string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, route+suffix+"?path=%2F", nil)
		w := httptest.NewRecorder()
		c := caller{Identity: gate.Identity{App: gate.HostID}}
		mux.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), callerKey{}, c)))
		return w
	}
	w := request("")
	var got api.DirListing
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || w.Code != http.StatusOK || got.Path != "/" || len(got.Entries) == 0 {
		t.Fatalf("host listing: status %d, body %s, decode %v", w.Code, w.Body, err)
	}
	for _, entry := range got.Entries {
		if entry.Type != "dir" || len(entry.Name) != 2 || entry.Name[0] < 'A' || entry.Name[0] > 'Z' || entry.Name[1] != ':' {
			t.Errorf("expected a drive: %+v", entry)
		}
	}
	if w := request("/content"); w.Code != http.StatusBadRequest {
		t.Fatalf("virtual root content: %d %s", w.Code, w.Body)
	}
}
