package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os/user"
	"strings"
	"time"

	"github.com/kumoSleeping/iridium/internal/config"
	"github.com/kumoSleeping/iridium/internal/gate"
)

// The person at the window is this computer's Iridium's host (gate.HostID), Iridium by name till
// given one (kumo, 2026-11-22: being called the program's name clashed). Once it runs, a host
// with no name of its own is given the system account's: never one it already has.

// ownName is the system account's name to give the host: its full name, else the login name;
// each only as a name Iridium takes (gate.NormalizeName). "": none.
func ownName(u *user.User) string {
	if u == nil {
		return ""
	}
	for _, n := range []string{strings.TrimSpace(strings.Split(u.Name, ",")[0]), u.Username} {
		if n, err := gate.NormalizeName(n); err == nil {
			return n
		}
	}
	return ""
}

// nameHost gives this computer's Iridium's host the system account's name if it has none, over
// its socket (the host's own way in).
func nameHost(logf func(string, ...any)) {
	cfg, err := config.Load(localPath())
	if err != nil {
		return
	}
	sock := cfg.SocketPath()
	hc := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", sock)
		},
	}}
	res, err := hc.Get("http://ir/v1/internal/me")
	if err != nil {
		logf("host name: %v", err)
		return
	}
	var me struct {
		Host  bool `json:"host"`
		Named bool `json:"named"`
	}
	err = json.NewDecoder(res.Body).Decode(&me)
	res.Body.Close()
	if err != nil || !me.Host || me.Named {
		return
	}
	u, _ := user.Current()
	n := ownName(u)
	if n == "" {
		return
	}
	body, _ := json.Marshal(map[string]string{"name": n})
	req, _ := http.NewRequest(http.MethodPut, "http://ir/v1/internal/me/profile", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res, err = hc.Do(req)
	if err != nil {
		logf("host name: %v", err)
		return
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		logf("host name %q: %s", n, fmt.Sprint(res.StatusCode))
		return
	}
	logf("host name: %s", n)
}
