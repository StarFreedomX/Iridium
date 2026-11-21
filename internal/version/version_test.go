package version

import "testing"

func TestIsRelease(t *testing.T) {
	for v, want := range map[string]bool{
		"v0.4.1": true, "1.2.3": true, "v10.0.12": true,
		"dev": false, "": false, "v0.4.2-dev.3+g1db5968": false, "v0.4.2-dev.3+g1db5968.dirty": false,
		"v1.2": false, "v1.2.3.4": false, "v1..3": false, "v1.2.3-rc1": false,
	} {
		if got := IsRelease(v); got != want {
			t.Errorf("IsRelease(%q) = %v, want %v", v, got, want)
		}
	}
}

func TestShort(t *testing.T) {
	for in, want := range map[string]string{"v0.2.48-dev.43+gd7491c4.dirty": "v0.2.48-dev", "v0.2.48": "v0.2.48", "dev": "dev", "v1.0.0+x": "v1.0.0"} {
		if got := Short(in); got != want {
			t.Errorf("Short(%q) = %q, want %q", in, got, want)
		}
	}
}
