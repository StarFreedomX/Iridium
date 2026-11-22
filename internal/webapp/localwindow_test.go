package webapp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// public.localWindow: the desktop app's window on loopback stays the host with a public origin;
// what comes through the tunnel (the public Host, or forwarded) does not.
func TestLocalWindow(t *testing.T) {
	h := newHarness(t, "https://ir.example.com")
	do := func(method, host, remote string, hdr map[string]string, path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://"+host+path, nil)
		r.Host, r.RemoteAddr = host, remote
		for k, v := range hdr {
			r.Header.Set(k, v)
		}
		rw := httptest.NewRecorder()
		h.h.ServeHTTP(rw, r)
		return rw
	}
	isHost := func(rw *httptest.ResponseRecorder) bool {
		var a appReply
		return rw.Code == 200 && json.Unmarshal(rw.Body.Bytes(), &a) == nil && a.Host
	}
	local := "127.0.0.1:50000"

	// Off: a loopback Host is refused as before.
	if rw := do("GET", "127.0.0.1:7810", local, nil, "/v1/x"); rw.Code != http.StatusMisdirectedRequest {
		t.Fatalf("off: %d %s", rw.Code, rw.Body)
	}
	h.w.cfg.LocalWindow = true
	if rw := do("GET", "127.0.0.1:7810", local, nil, "/v1/x"); !isHost(rw) {
		t.Fatalf("window: %d %s", rw.Code, rw.Body)
	}
	if rw := do("GET", "localhost:7810", "[::1]:50000", nil, "/_ir/api/session"); rw.Code != 200 || !strings.Contains(rw.Body.String(), `"local":true`) {
		t.Fatalf("session: %d %s", rw.Code, rw.Body)
	}
	// Through the tunnel (forwarded), from elsewhere, or with the public Host: not the host.
	for name, rw := range map[string]*httptest.ResponseRecorder{
		"forwarded":   do("GET", "127.0.0.1:7810", local, map[string]string{"Cf-Connecting-IP": "203.0.113.9"}, "/v1/x"),
		"x-forwarded": do("GET", "127.0.0.1:7810", local, map[string]string{"X-Forwarded-For": "203.0.113.9"}, "/v1/x"),
		"far peer":    do("GET", "127.0.0.1:7810", "192.0.2.4:50000", nil, "/v1/x"),
		"public host": do("GET", "ir.example.com", local, nil, "/v1/x"),
	} {
		if isHost(rw) {
			t.Errorf("%s: the host", name)
		}
	}
	if rw := do("GET", "ir.example.com", local, nil, "/v1/x"); rw.Code != http.StatusUnauthorized && rw.Code != http.StatusFound {
		t.Errorf("public host, no session: %d", rw.Code)
	}
	// Another site's page may not act as the window.
	if rw := do("POST", "127.0.0.1:7810", local, map[string]string{"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"}, "/v1/x"); rw.Code != http.StatusForbidden {
		t.Errorf("cross-site: %d", rw.Code)
	}
	if rw := do("POST", "127.0.0.1:7810", local, map[string]string{"Origin": "http://127.0.0.1:7810", "Sec-Fetch-Site": "same-origin"}, "/v1/x"); !isHost(rw) {
		t.Errorf("same origin: %d %s", rw.Code, rw.Body)
	}
}
