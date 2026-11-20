package webapp

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
)

type appStartReply struct {
	ID, Code, URL string
}

type appPollReply struct {
	Status, Ticket string
}

// startApp is the app's first step: no cookie, no Origin (not a page).
func (h *harness) startApp(name, secret string) appStartReply {
	h.t.Helper()
	v := sha256.Sum256([]byte(secret))
	w := h.do(req{method: "POST", path: "/_ir/api/app/start", noCookie: true, header: map[string]string{"Origin": "", "Sec-Fetch-Site": ""},
		body: appStartRequest{Name: name, Verifier: base64.RawURLEncoding.EncodeToString(v[:])}})
	wantStatus(h.t, w, http.StatusOK)
	return decode[appStartReply](h.t, w)
}

func (h *harness) pollApp(id, secret string) (appPollReply, int) {
	h.t.Helper()
	w := h.do(req{method: "POST", path: "/_ir/api/app/poll", noCookie: true, header: map[string]string{"Origin": "", "Sec-Fetch-Site": ""},
		body: appPollRequest{ID: id, Secret: secret}})
	if w.Code != http.StatusOK {
		return appPollReply{}, w.Code
	}
	return decode[appPollReply](h.t, w), w.Code
}

func TestAppLogin(t *testing.T) {
	h := newHarness(t, testOrigin)
	a := &authenticator{t: t, origin: testOrigin}
	wantStatus(t, h.join(a, h.setupToken(), ptr("Kumo")), http.StatusOK)
	me, _ := h.whoami()
	browser := h.cookie

	s := h.startApp("kumo-mac", "the app's secret")
	if !strings.HasPrefix(s.URL, testOrigin+"/_ir/app?id=") || len(s.Code) != 7 {
		t.Fatalf("start: %+v", s)
	}
	h.secrets = append(h.secrets, s.ID)
	if p, _ := h.pollApp(s.ID, "the app's secret"); p.Status != "pending" {
		t.Fatalf("poll before the answer: %+v", p)
	}
	// Who has the id alone (it is in the browser's address bar) gets nothing.
	if _, code := h.pollApp(s.ID, "a guess"); code != http.StatusNotFound {
		t.Fatalf("poll with a wrong secret: %d", code)
	}
	// The page: logged in, from this site.
	h.cookie = ""
	wantStatus(t, h.do(req{method: "POST", path: "/_ir/api/app/info", body: appIDRequest{ID: s.ID}}), http.StatusUnauthorized)
	h.cookie = browser
	wantStatus(t, h.do(req{method: "POST", path: "/_ir/api/app/answer", body: appIDRequest{ID: s.ID, Allow: true},
		header: map[string]string{"Origin": "https://evil.test", "Sec-Fetch-Site": "cross-site"}}), http.StatusForbidden)
	info := decode[map[string]any](t, h.do(req{method: "POST", path: "/_ir/api/app/info", body: appIDRequest{ID: s.ID}}))
	if info["name"] != "kumo-mac" || info["code"] != s.Code {
		t.Fatalf("info: %v", info)
	}
	wantStatus(t, h.do(req{method: "POST", path: "/_ir/api/app/answer", body: appIDRequest{ID: s.ID, Allow: true}}), http.StatusOK)
	wantStatus(t, h.do(req{method: "POST", path: "/_ir/api/app/answer", body: appIDRequest{ID: s.ID, Allow: false}}), http.StatusConflict)

	p, _ := h.pollApp(s.ID, "the app's secret")
	if p.Status != "allowed" || p.Ticket == "" {
		t.Fatalf("poll after allowing: %+v", p)
	}
	h.secrets = append(h.secrets, p.Ticket)
	if _, code := h.pollApp(s.ID, "the app's secret"); code != http.StatusNotFound {
		t.Fatalf("a second ticket: %d", code)
	}

	// The app's web view: no cookie of its own yet; the ticket makes it the same login.
	h.cookie = ""
	w := h.do(req{path: "/_ir/app/finish?ticket=" + p.Ticket})
	wantStatus(t, w, http.StatusFound)
	if loc := w.Header().Get("Location"); loc != "/" || h.cookie == "" || h.cookie == browser {
		t.Fatalf("finish: to %q, cookie set %v", loc, h.cookie != "")
	}
	if got, code := h.whoami(); code != http.StatusOK || got.Login != me.Login {
		t.Fatalf("the app is %+v (%d), want %s", got, code, me.Login)
	}
	// Once only.
	app := h.cookie
	h.cookie = ""
	if w := h.do(req{path: "/_ir/app/finish?ticket=" + p.Ticket}); w.Header().Get("Location") != "/_ir/login" || h.cookie != "" {
		t.Fatalf("a ticket used twice: %d %q", w.Code, w.Header().Get("Location"))
	}
	h.cookie = app
	h.noSecretsLogged()
}

func TestAppLoginDeniedAndExpired(t *testing.T) {
	h := newHarness(t, testOrigin)
	a := &authenticator{t: t, origin: testOrigin}
	wantStatus(t, h.join(a, h.setupToken(), ptr("Kumo")), http.StatusOK)

	s := h.startApp("other", "s1")
	wantStatus(t, h.do(req{method: "POST", path: "/_ir/api/app/answer", body: appIDRequest{ID: s.ID, Allow: false}}), http.StatusOK)
	if p, _ := h.pollApp(s.ID, "s1"); p.Status != "denied" || p.Ticket != "" {
		t.Fatalf("denied: %+v", p)
	}
	if _, code := h.pollApp(s.ID, "s1"); code != http.StatusNotFound {
		t.Fatalf("after denied: %d", code)
	}

	s = h.startApp("late", "s2")
	h.clock.Advance(AppLoginTTL)
	if _, code := h.pollApp(s.ID, "s2"); code != http.StatusNotFound {
		t.Fatalf("expired: %d", code)
	}
	wantStatus(t, h.do(req{method: "POST", path: "/_ir/api/app/answer", body: appIDRequest{ID: s.ID, Allow: true}}), http.StatusNotFound)

	// A ticket not used in time is gone.
	s = h.startApp("slow", "s3")
	wantStatus(t, h.do(req{method: "POST", path: "/_ir/api/app/answer", body: appIDRequest{ID: s.ID, Allow: true}}), http.StatusOK)
	p, _ := h.pollApp(s.ID, "s3")
	h.clock.Advance(AppTicketTTL)
	h.cookie = ""
	if w := h.do(req{path: "/_ir/app/finish?ticket=" + p.Ticket}); w.Header().Get("Location") != "/_ir/login" || h.cookie != "" {
		t.Fatalf("a late ticket: %q", w.Header().Get("Location"))
	}

	// Bad starts.
	for _, body := range []appStartRequest{{Name: "x", Verifier: "short"}, {Name: "", Verifier: base64.RawURLEncoding.EncodeToString(make([]byte, 32))}, {Name: "a\nb", Verifier: base64.RawURLEncoding.EncodeToString(make([]byte, 32))}} {
		wantStatus(t, h.do(req{method: "POST", path: "/_ir/api/app/start", noCookie: true, body: body}), http.StatusBadRequest)
	}
}
