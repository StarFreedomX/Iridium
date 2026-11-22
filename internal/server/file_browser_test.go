package server

import (
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/kumoSleeping/iridium/internal/api"
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
