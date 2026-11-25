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
		Scope: []string{here, "pc:" + here, "pc:" + filepath.Join(shared, "deleted"), "pc:" + there},
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
		if filepath.FromSlash(list.Path) != dir || !list.Open || len(list.Entries) != 1 || list.Entries[0].Name != name {
			t.Fatalf("starting folder at %q: %+v, want %s with %s", machine, list, dir, name)
		}
		if w := req(t, "/content", machine, filepath.Join(dir, name), http.StatusPartialContent); w.Body.String() != content[:7] {
			t.Fatalf("preview at %q: %q", machine, w.Body)
		}
	}
	// Traversal is only a projection of the next granted directory, not access to its parent.
	for _, tc := range []struct{ machine, dir, child string }{
		{"", l.work, "here"},
		{"pc", l.work, "shared"},
		{"pc", shared, "there"},
	} {
		w := req(t, "", tc.machine, tc.dir, http.StatusOK)
		var list api.DirListing
		if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil || list.Open ||
			!slices.Equal(list.Entries, []api.DirEntry{{Name: tc.child, Type: "dir"}}) {
			t.Fatalf("projected listing at %s:%s: %s (%v)", tc.machine, tc.dir, w.Body, err)
		}
	}
	req(t, "", "pc", sibling, http.StatusForbidden)
	ancestorFile := filepath.Join(shared, name)
	if err := os.WriteFile(ancestorFile, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	req(t, "/content", "pc", ancestorFile, http.StatusForbidden)
	mkdir := func(dir, name string, want int) {
		t.Helper()
		w := httptest.NewRecorder()
		body := strings.NewReader(string(mustJSON(api.NewFolder{Machine: "pc", Name: name, Path: dir})))
		r := httptest.NewRequest(http.MethodPost, "/v1/internal/folders", body)
		l.s.makeFolder(w, r.WithContext(context.WithValue(r.Context(), callerKey{}, c)))
		if w.Code != want {
			t.Fatalf("mkdir at %s: %d %s, want %d", dir, w.Code, w.Body, want)
		}
	}
	mkdir(shared, "blocked", http.StatusForbidden)
	dotDir := filepath.Join(there, ".worktrees")
	if err := os.Mkdir(dotDir, 0o700); err != nil {
		t.Fatal(err)
	}
	mkdir(dotDir, "allowed", http.StatusOK)
	if _, err := os.Stat(filepath.Join(dotDir, "allowed")); err != nil {
		t.Fatal(err)
	}
	escape := filepath.Join(there, "escape")
	if err := os.Symlink(sibling, escape); err == nil {
		mkdir(escape, "blocked", http.StatusForbidden)
		mkdir(there, "escape", http.StatusForbidden)
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
	alias := filepath.Join(l.work, "shared-alias")
	if err := os.Symlink(there, alias); err != nil {
		t.Logf("skipping directory alias checks: %v", err)
	} else {
		mkdir(alias, "via-alias", http.StatusOK)
		mkdir(alias, "via-alias", http.StatusConflict)
		l.want(http.StatusOK, "socket", http.MethodPut, "/v1/internal/apps/"+gate.WebApp+"/logins/"+login.ID+"/perms",
			api.Perms{Scope: []string{"pc:" + alias}}, nil)
		w := req(t, "", "pc", "", http.StatusOK)
		var list api.DirListing
		if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil || !list.Open || filepath.FromSlash(list.Path) != alias {
			t.Fatalf("remote alias default: %s (%v)", w.Body, err)
		}
		mkdir(there, "via-canonical", http.StatusOK)
		for _, name := range []string{"via-alias", "via-canonical"} {
			if st, err := os.Stat(filepath.Join(there, name)); err != nil || !st.IsDir() {
				t.Fatalf("expected directory %s in canonical path: %v", name, err)
			}
		}
	}

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
	calls := make(chan testBrowserDriveCall, 4)
	conn.OnRequest = func(_ context.Context, method string, raw json.RawMessage) (any, error) {
		var p wire.PathParams
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, err
		}
		calls <- testBrowserDriveCall{method, p}
		if method == "fs.stat" {
			return wire.Stat{Type: "dir"}, nil // A legacy executor that ignores StatParams.Scope.
		}
		return wire.ListReply{Entries: []wire.Entry{{Name: "D:", Type: "dir"}}}, nil
	}
	go conn.Run(ctx)
	hi := wire.Hello{Protocol: wire.Protocol, OS: "windows", Sep: `\`, Home: `D:\project`}
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
	request := func(route, query string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, route+query, nil)
		w := httptest.NewRecorder()
		mux := http.NewServeMux()
		l.s.fileRoutes(mux, false)
		mux.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), callerKey{}, c)))
		return w
	}
	w := request("/v1/internal/web/files", q)
	var got api.DirListing
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || w.Code != http.StatusOK ||
		got.Path != "/" || got.Open || len(got.Entries) != 1 || got.Entries[0].Name != "D:" || got.Entries[0].Type != "dir" {
		t.Fatalf("listing: status %d, body %s, decode %v", w.Code, w.Body, err)
	}
	call := <-calls
	if call.method != "fs.list.browser" || call.params.Path != "/" || !slices.Equal(call.params.Scope, []string{`D:\project`}) {
		t.Fatalf("unexpected executor call: %+v", call)
	}
	if w := request("/v1/internal/web/files/content", q); w.Code != http.StatusBadRequest {
		t.Fatalf("virtual root content: %d %s", w.Code, w.Body)
	}
	select {
	case call := <-calls:
		t.Fatalf("virtual root content was forwarded: %+v", call)
	default:
	}
	// An older executor omits open. Its ordinary directory listing is still fully open.
	w = request("/v1/internal/web/files", "?machine="+url.QueryEscape(app.App.ID))
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || w.Code != http.StatusOK || got.Path != "D:/project" || !got.Open {
		t.Fatalf("old executor's real listing: status %d, body %s, decode %v", w.Code, w.Body, err)
	}
	if call := <-calls; call.params.Path != `D:\project` {
		t.Fatalf("old executor's starting path: %+v", call)
	}

	// "~" is expanded before the lexical check, but a scoped write must still refuse an
	// executor that cannot enforce scope on resolved paths.
	w = httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/internal/folders", strings.NewReader(
		string(mustJSON(api.NewFolder{Machine: app.App.ID, Name: "new", Path: "~"}))))
	l.s.makeFolder(w, r.WithContext(context.WithValue(r.Context(), callerKey{}, c)))
	if w.Code != http.StatusConflict {
		t.Fatalf("legacy unscoped stat permitted mkdir: %d %s", w.Code, w.Body)
	}
	for _, scope := range [][]string{{`D:\project`}, {""}} {
		if call := <-calls; call.method != "fs.stat" || call.params.Path != `D:\project` || !slices.Equal(call.params.Scope, scope) {
			t.Fatalf("unexpected scoped stat request: %+v", call)
		}
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
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil || w.Code != http.StatusOK || got.Path != "/" || got.Open || len(got.Entries) == 0 {
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

func TestBrowserStartsWindows(t *testing.T) {
	hi := &wire.Hello{Sep: `\`, Home: `D:\Home`, Roots: []string{`D:\Shared`, `\\NAS\Share\project`}}
	scope := []string{`d:\Other`, `d:\shared\work`, `\\nas\share\`}
	got := browserStarts(hi, scope)
	want := []string{`d:\shared\work`, `\\NAS\Share\project`, `d:\Other`, `\\nas\share\`, `D:\Shared`}
	if !slices.Equal(got, want) {
		t.Fatalf("starting candidates: got %v, want %v", got, want)
	}
	for _, tc := range []struct {
		name, root string
		want       bool
	}{
		{`C:\..\Work\notes`, `c:\work`, true},
		{`C:\Workshop`, `c:\work`, false},
		{`\\nas\share2\notes`, `\\NAS\Share`, false},
		{`\\nas\share\..\notes`, `\\NAS\Share`, true},
		{`D:\Home\notes`, `\\`, false},
	} {
		if got := pathKeyWithin(remotePathKey(hi, tc.name), remotePathKey(hi, tc.root)); got != tc.want {
			t.Errorf("is %q within %q: got %v, want %v", tc.name, tc.root, got, tc.want)
		}
	}
}
