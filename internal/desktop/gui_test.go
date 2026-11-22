package desktop

import "testing"

func TestIsServer(t *testing.T) {
	c := Config{Servers: []Server{{URL: "https://ir.kumo.ltd"}, {URL: "http://127.0.0.1:7811"}}}
	for o, want := range map[string]bool{
		"https://ir.kumo.ltd": true, "https://IR.kumo.ltd": true, "http://ir.kumo.ltd": false, "https://ir.kumo.ltd.evil.com": false,
		"http://127.0.0.1:7811": true, "http://127.0.0.1:7810": false, "mygo://localhost": false, "": false, "null": false,
	} {
		if got := isServer(c, o); got != want {
			t.Errorf("isServer(%q) = %v", o, got)
		}
	}
}
