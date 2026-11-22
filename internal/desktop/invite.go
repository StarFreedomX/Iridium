package desktop

import (
	"net/url"
	"strings"
)

// inviteOrigin: is s an invite link of an Iridium's (its path /_ir/join), and that Iridium's
// address?
func inviteOrigin(s string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(s))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || strings.TrimSuffix(u.Path, "/") != "/_ir/join" {
		return "", false
	}
	return u.Scheme + "://" + u.Host, true
}

// inviteFor is the invite link the browser opens for the app's login at appURL (…/_ir/app?id=…):
// the name prefilled, and once the passkey is made, on to allowing the app (app=<id>).
func inviteFor(invite, appURL, name string) string {
	u, err := url.Parse(invite)
	a, err2 := url.Parse(appURL)
	if err != nil || err2 != nil {
		return invite
	}
	q := u.Query()
	q.Set("app", a.Query().Get("id"))
	if name != "" {
		q.Set("name", name)
	}
	u.RawQuery = q.Encode()
	return u.String()
}
