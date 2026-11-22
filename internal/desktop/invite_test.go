package desktop

import "testing"

func TestInvite(t *testing.T) {
	if o, ok := inviteOrigin(" https://ir.example.com/_ir/join?i=abc#k "); !ok || o != "https://ir.example.com" {
		t.Fatalf("invite: %q %v", o, ok)
	}
	for _, s := range []string{"ir.example.com", "https://ir.example.com", "https://ir.example.com/_ir/login", "ftp://x/_ir/join"} {
		if _, ok := inviteOrigin(s); ok {
			t.Errorf("%q taken for an invite", s)
		}
	}
	got := inviteFor("https://ir.example.com/_ir/join?i=abc#k", "https://ir.example.com/_ir/app?id=X1", "kumo")
	if got != "https://ir.example.com/_ir/join?app=X1&i=abc&name=kumo#k" {
		t.Fatalf("inviteFor: %s", got)
	}
}
