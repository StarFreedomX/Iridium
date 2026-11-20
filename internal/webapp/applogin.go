package webapp

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/kumoSleeping/iridium/internal/gate"
)

// The desktop app's login (docs/app.md "登录"): its web view has no passkey (WebKitGTK, an
// unsigned macOS app), so it is logged in from the system's browser, where the person has one.
//
//  1. The app asks: POST /_ir/api/app/start {name, verifier} → {id, code, url}; verifier is the
//     SHA-256 (base64url) of a secret only the app holds.
//  2. It opens url (/_ir/app?id=…) in the system's browser; there the person, logged in (or
//     logging in) with a passkey, sees which computer asks and its code (shown in the app too),
//     and allows or turns it down: POST /_ir/api/app/info, /_ir/api/app/answer, with the cookie.
//  3. The app polls POST /_ir/api/app/poll {id, secret}: once allowed it gets a ticket, once.
//  4. Its web view goes to GET /_ir/app/finish?ticket=…: a session of the login that allowed it,
//     its cookie set there, and on to the page.
//
// Who knows the id alone (it is in the browser's address bar) gets nothing: the ticket needs the
// secret, and the finish needs the ticket. A request is pending AppLoginTTL at most, a ticket
// AppTicketTTL; both are in memory only.
const (
	AppLoginTTL  = 10 * time.Minute
	AppTicketTTL = 2 * time.Minute
	maxAppLogins = 50
)

type appLogin struct {
	name     string // the computer's, as it says
	verifier []byte // SHA-256 of the app's secret
	code     string // shown on both sides
	expires  time.Time

	answered bool
	allowed  bool
	login    string // the login that allowed it
	passkey  []byte // the passkey that login's session was made with
	ticket   string // HashSecret of the ticket, once handed out
}

type appLogins struct {
	mu sync.Mutex
	m  map[string]*appLogin // by id
}

func (a *appLogins) pruneLocked(now time.Time) {
	for id, l := range a.m {
		if !now.Before(l.expires) {
			delete(a.m, id)
		}
	}
}

// codeAlphabet: no 0/O, 1/I/L.
const codeAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

func newCode() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	out := make([]byte, 0, 7)
	for i, c := range b {
		if i == 3 {
			out = append(out, '-')
		}
		out = append(out, codeAlphabet[int(c)%len(codeAlphabet)])
	}
	return string(out)
}

type appStartRequest struct {
	Name     string `json:"name"`
	Verifier string `json:"verifier"`
}

// apiAppStart: the app's first step; open to anyone (as pairing is), bounded in number.
func (w *Web) apiAppStart(rw http.ResponseWriter, r *http.Request, key string) {
	var req appStartRequest
	if !decodeJSON(rw, r, &req) {
		return
	}
	v, err := base64.RawURLEncoding.DecodeString(req.Verifier)
	name := strings.TrimSpace(req.Name)
	if err != nil || len(v) != sha256.Size || name == "" || utf8.RuneCountInString(name) > 40 || strings.ContainsFunc(name, func(r rune) bool { return r < 0x20 || r == 0x7f }) {
		writeJSON(rw, http.StatusBadRequest, apiError{"bad_request"})
		return
	}
	now := w.now()
	w.apps.mu.Lock()
	w.apps.pruneLocked(now)
	if len(w.apps.m) >= maxAppLogins {
		w.apps.mu.Unlock()
		w.failed(rw, key, "app login", http.StatusTooManyRequests, "too_many", errors.New("too many pending"))
		return
	}
	id := gate.NewSecret()
	l := &appLogin{name: name, verifier: v, code: newCode(), expires: now.Add(AppLoginTTL)}
	w.apps.m[id] = l
	w.apps.mu.Unlock()
	w.log.Info("webapp: app login asked", "name", name, "client", key)
	writeJSON(rw, http.StatusOK, map[string]any{"id": id, "code": l.code, "url": w.origin + "/_ir/app?id=" + id, "expires": l.expires})
}

type appPollRequest struct {
	ID     string `json:"id"`
	Secret string `json:"secret"`
}

// apiAppPoll: the app waiting; only it has the secret.
func (w *Web) apiAppPoll(rw http.ResponseWriter, r *http.Request, key string) {
	var req appPollRequest
	if !decodeJSON(rw, r, &req) {
		return
	}
	sum := sha256.Sum256([]byte(req.Secret))
	now := w.now()
	w.apps.mu.Lock()
	defer w.apps.mu.Unlock()
	w.apps.pruneLocked(now)
	l, ok := w.apps.m[req.ID]
	if !ok || subtle.ConstantTimeCompare(sum[:], l.verifier) != 1 {
		writeJSON(rw, http.StatusNotFound, apiError{"expired"})
		return
	}
	switch {
	case !l.answered:
		writeJSON(rw, http.StatusOK, map[string]string{"status": "pending"})
	case !l.allowed:
		delete(w.apps.m, req.ID)
		writeJSON(rw, http.StatusOK, map[string]string{"status": "denied"})
	case l.ticket != "":
		writeJSON(rw, http.StatusNotFound, apiError{"expired"}) // handed out already
	default:
		t := gate.NewSecret()
		l.ticket = gate.HashSecret(t)
		l.expires = now.Add(AppTicketTTL)
		name := ""
		if info, ok := w.core.Endpoint(l.login); ok {
			name = info.Name
		}
		writeJSON(rw, http.StatusOK, map[string]string{"status": "allowed", "ticket": t, "name": name})
	}
}

// appFinish: the app's web view, with its ticket, logged in as the login that allowed it.
func (w *Web) appFinish(rw http.ResponseWriter, r *http.Request) {
	t := r.URL.Query().Get("ticket")
	now := w.now()
	var found *appLogin
	if gate.WellFormedSecret(t) {
		h := gate.HashSecret(t)
		w.apps.mu.Lock()
		w.apps.pruneLocked(now)
		for id, l := range w.apps.m {
			if l.ticket != "" && subtle.ConstantTimeCompare([]byte(l.ticket), []byte(h)) == 1 {
				found = l
				delete(w.apps.m, id)
				break
			}
		}
		w.apps.mu.Unlock()
	}
	if found == nil {
		http.Redirect(rw, r, "/_ir/login", http.StatusFound)
		return
	}
	w.mu.Lock()
	info, live := w.core.Endpoint(found.login)
	if !live || info.Kind != gate.KindPanel {
		w.mu.Unlock()
		http.Redirect(rw, r, "/_ir/login", http.StatusFound)
		return
	}
	token, s := w.newSessionLocked(found.login, found.passkey, r, now)
	s.Device, s.App, s.ExpiresAt = DeviceComputer, true, now.Add(AppTimeout)
	err := w.commitLocked(Change{Sessions: []Session{s}})
	w.mu.Unlock()
	if err != nil {
		writeJSON(rw, http.StatusInternalServerError, apiError{"internal"})
		return
	}
	w.core.Seen(found.login)
	w.log.Info("webapp: app logged in", "endpoint", found.login, "name", info.Name, "computer", found.name)
	http.SetCookie(rw, cookieFor(token, AppTimeout))
	// On to the page from a page of this site, not by a redirect: the app's window came here from
	// its own page, another site, and a redirect of that navigation is still that site's, which
	// a SameSite=Strict cookie is not sent with: the page would have found itself logged out.
	rw.Header().Set("Content-Type", "text/html; charset=utf-8")
	rw.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(rw, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>Iridium</title>`)
}

type appIDRequest struct {
	ID    string `json:"id"`
	Allow bool   `json:"allow"`
}

// appAsked is the pending request a logged-in browser names, and the answer it sends; when it
// is not (not logged in, no such request) it has answered.
func (w *Web) appAsked(rw http.ResponseWriter, r *http.Request) (sess Session, l *appLogin, allow, ok bool) {
	sess, ok = w.identify(r, w.now())
	if !ok {
		writeJSON(rw, http.StatusUnauthorized, apiError{"unauthenticated"})
		return
	}
	var req appIDRequest
	if ok = decodeJSON(rw, r, &req); !ok {
		return
	}
	w.apps.mu.Lock()
	w.apps.pruneLocked(w.now())
	l, ok = w.apps.m[req.ID]
	w.apps.mu.Unlock()
	if !ok {
		writeJSON(rw, http.StatusNotFound, apiError{"expired"})
	}
	return sess, l, req.Allow, ok
}

// apiAppInfo: what the browser shows before the person answers.
func (w *Web) apiAppInfo(rw http.ResponseWriter, r *http.Request) {
	_, l, _, ok := w.appAsked(rw, r)
	if !ok {
		return
	}
	w.apps.mu.Lock()
	reply := map[string]any{"name": l.name, "code": l.code, "answered": l.answered}
	w.apps.mu.Unlock()
	writeJSON(rw, http.StatusOK, reply)
}

// apiAppAnswer: the person allows the app (as their login) or turns it down; once.
func (w *Web) apiAppAnswer(rw http.ResponseWriter, r *http.Request, key string) {
	sess, l, allow, ok := w.appAsked(rw, r)
	if !ok {
		return
	}
	w.apps.mu.Lock()
	if l.answered {
		w.apps.mu.Unlock()
		writeJSON(rw, http.StatusConflict, apiError{"answered"})
		return
	}
	l.answered, l.allowed, l.login, l.passkey = true, allow, sess.Login, sess.Passkey
	w.apps.mu.Unlock()
	w.log.Info("webapp: app login answered", "endpoint", sess.Login, "allowed", allow, "computer", l.name, "client", key)
	writeJSON(rw, http.StatusOK, map[string]bool{"ok": true})
}
