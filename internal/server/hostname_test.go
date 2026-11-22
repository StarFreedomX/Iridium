package server

import (
	"net/http"
	"strings"
	"testing"

	"github.com/kumoSleeping/iridium/internal/api"
	"github.com/kumoSleeping/iridium/internal/satori"
)

// The host may have a name of its own (the desktop app's user, gate host.go): its words carry it,
// and it lasts.
func TestHostName(t *testing.T) {
	t.Parallel()
	l := start(t)
	var me api.Me
	l.want(200, "socket", "GET", "/v1/internal/me", nil, &me)
	if me.Name != "Iridium" || me.Named {
		t.Fatalf("unset: %+v", me)
	}
	req, _ := http.NewRequest(http.MethodPut, "http://ir/v1/internal/me/profile", strings.NewReader(`{"name":"kumo"}`))
	req.Header.Set("Content-Type", "application/json")
	res, err := l.sock.Do(req)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("named: %v %v", res, err)
	}
	res.Body.Close()
	l.want(200, "web", "GET", "/v1/internal/me", nil, &me)
	if me.Name != "kumo" || !me.Named || !me.Host {
		t.Fatalf("named: %+v", me)
	}
	var as api.Apps
	l.want(200, "socket", "GET", "/v1/internal/apps", nil, &as)
	if !as.Apps[0].Host || !as.Apps[0].Named || as.Apps[0].Name != "kumo" {
		t.Fatalf("listed: %+v", as.Apps[0])
	}
	var meta satori.Meta
	if code, raw := l.irSatori("socket", "", "meta", nil, &meta); code != 200 || len(meta.Logins) != 1 || meta.Logins[0].User == nil || meta.Logins[0].User.Name != "kumo" {
		t.Fatalf("meta: %d %s", code, raw)
	}
	if v := l.s.st.Kept("host:name"); v != "kumo" {
		t.Fatalf("kept %q", v)
	}
}
