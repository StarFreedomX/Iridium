package desktop

import (
	"bytes"
	"encoding/base64"
	"strings"

	"github.com/egoist/mygo"
	"github.com/kumoSleeping/iridium/internal/gate"
)

// smallFace is a face the app keeps (who one is on an Iridium, an Iridium's own, the first page's
// own) as the daemon keeps every face (gate.MakeAvatar: 128 px, a JPEG or a PNG; kumo,
// 2026-11-23: every upload made small): it is in app.json and goes to the picker with each of its
// states. "": none, or not an image.
func smallFace(dataURL string) string {
	if dataURL == "" {
		return ""
	}
	head, b64, ok := strings.Cut(dataURL, ",")
	if !ok || !strings.HasPrefix(head, "data:image/") || !strings.HasSuffix(head, ";base64") {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return ""
	}
	img, _, err := gate.MakeAvatar(raw)
	if err != nil {
		return ""
	}
	if len(img) >= len(raw) && len(dataURL) <= 64<<10 {
		return dataURL // already as small, kept as it came
	}
	mime := "image/jpeg"
	if bytes.HasPrefix(img, []byte("\x89PNG")) {
		mime = "image/png"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(img)
}

// smallFaces makes the faces kept from before small (smallFace), once, as the app starts.
func smallFaces() {
	c, err := loadConfig()
	if err != nil {
		return
	}
	big := func(s string) bool { return len(s) > 64<<10 }
	need := big(c.Me.Avatar)
	for _, s := range c.Servers {
		need = need || big(s.Avatar) || big(s.Face)
	}
	if !need {
		return
	}
	_, _ = updateConfig(func(c *Config) {
		if big(c.Me.Avatar) {
			c.Me.Avatar = smallFace(c.Me.Avatar)
		}
		for i := range c.Servers {
			if big(c.Servers[i].Avatar) {
				c.Servers[i].Avatar = smallFace(c.Servers[i].Avatar)
			}
			if big(c.Servers[i].Face) {
				c.Servers[i].Face = smallFace(c.Servers[i].Face)
			}
		}
	})
}

// dropLoginItem takes away, once, the login item a 登录时打开 of before left (Wails's and mygo's
// are the same on a Mac from 13 on: the app's SMAppService), there being no switch for it now.
// Once only: one the person adds in the system's settings after is theirs.
func dropLoginItem() {
	if c, err := loadConfig(); err != nil || c.LoginItemGone {
		return
	}
	if mygo.App.OpenAtLogin() {
		if err := mygo.App.SetOpenAtLogin(false); err != nil {
			appLog()("login item: %v", err)
			return
		}
		appLog()("login item taken away (登录时打开 is gone)")
	}
	_, _ = updateConfig(func(c *Config) { c.LoginItemGone = true })
}
