package desktop

import (
	"os/user"
	"testing"
)

func TestOwnName(t *testing.T) {
	for _, c := range []struct {
		u    *user.User
		want string
	}{
		{&user.User{Name: "kumo", Username: "kumo"}, "kumo"},
		{&user.User{Name: "Ann Lee,,,", Username: "ann"}, "Ann Lee"},
		{&user.User{Name: "Kumo Yamamoto", Username: "kumo"}, "kumo"}, // too long: the login name
		{&user.User{Name: "", Username: "ann"}, "ann"},
		{&user.User{Name: "Iridium", Username: "iri"}, "iri"}, // reserved: the login name
		{&user.User{Name: "", Username: "x"}, ""},             // one letter: none
		{nil, ""},
	} {
		if got := ownName(c.u); got != c.want {
			t.Errorf("ownName(%+v) = %q, want %q", c.u, got, c.want)
		}
	}
}
