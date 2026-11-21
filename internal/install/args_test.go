package install

import (
	"strings"
	"testing"
)

// serve's options go into the unit and the task as given.
func TestArgs(t *testing.T) {
	u := UnitArgs("/opt/iridium", "/c.json", "", []string{"--no-server", "--join", "https://a", "--name", "my nas"})
	if !strings.Contains(u, `ExecStart=/opt/iridium serve -config /c.json --no-server --join https://a --name "my nas"`+"\n") {
		t.Fatalf("unit:\n%s", u)
	}
	x := TaskXML(`C:\i.exe`, `C:\c.json`, `PC\a`, "--join", "https://a", "--name", "my nas")
	if !strings.Contains(x, `<Arguments>serve -config &#34;C:\c.json&#34; --join https://a --name &#34;my nas&#34;</Arguments>`) {
		t.Fatalf("task:\n%s", x)
	}
}
