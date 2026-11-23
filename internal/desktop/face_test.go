package desktop

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

func TestSmallFace(t *testing.T) {
	// A large opaque picture: kept as a 128 px JPEG, far smaller.
	im := image.NewNRGBA(image.Rect(0, 0, 900, 700))
	for y := range 700 {
		for x := range 900 {
			im.Set(x, y, color.NRGBA{uint8(x), uint8(y), uint8(x ^ y), 255})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, im); err != nil {
		t.Fatal(err)
	}
	in := "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
	out := smallFace(in)
	if !strings.HasPrefix(out, "data:image/jpeg;base64,") || len(out) >= len(in) {
		t.Fatalf("smallFace: %d bytes from %d, %.30q", len(out), len(in), out)
	}
	raw, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(out, "data:image/jpeg;base64,"))
	if c, _, err := image.DecodeConfig(bytes.NewReader(raw)); err != nil || c.Width != 128 || c.Height != 128 {
		t.Fatalf("not 128 px: %v %v", c, err)
	}
	for _, bad := range []string{"", "data:text/html;base64,PGI+", "data:image/png;base64,!!", "https://x/y.png"} {
		if got := smallFace(bad); got != "" {
			t.Errorf("smallFace(%q) = %q", bad, got)
		}
	}
}
