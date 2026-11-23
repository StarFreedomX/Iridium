package macapp

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestWrite(t *testing.T) {
	app := filepath.Join(t.TempDir(), "Iridium.app")
	// As installed by a release before: its own plist and icon.
	os.MkdirAll(filepath.Join(app, "Contents", "Resources"), 0o755)
	os.WriteFile(filepath.Join(app, "Contents", "Info.plist"), []byte("old"), 0o644)
	if err := Write(app, "v9.9.9"); err != nil {
		t.Fatal(err)
	}
	p, _ := os.ReadFile(filepath.Join(app, "Contents", "Info.plist"))
	if !bytes.Contains(p, []byte("<string>v9.9.9</string>")) || !bytes.Contains(p, []byte(ID)) {
		t.Fatalf("Info.plist: %s", p)
	}
	i, _ := os.ReadFile(filepath.Join(app, "Contents", "Resources", "icon.icns"))
	if !bytes.Equal(i, ICNS(Icon)) || !bytes.HasPrefix(i, []byte("icns")) {
		t.Fatal("icon.icns is not the app's")
	}
	if Of(filepath.Join(app, "Contents", "MacOS", "iridium")) != app || Of("/usr/local/bin/iridium") != "" {
		t.Fatal("Of")
	}
}
