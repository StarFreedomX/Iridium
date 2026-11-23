// Package macapp is Iridium.app, the macOS app around the one binary (docs/app.md "构建"): its
// Info.plist and icon, written as a release makes the bundle (internal/desktop/sign) and again as
// an update puts a new binary in it (internal/update, internal/join), and its signature. Updated
// by its binary alone, an app kept the Info.plist and the icon it was installed with (2026-11-23).
package macapp

import (
	"bytes"
	_ "embed"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Icon is the app's icon on a macOS icon's grid (internal/desktop/sign icons): the Dock's as it
// runs, and the bundle's.
//
//go:embed icon-mac.png
var Icon []byte

// ID is the bundle's identifier, its signature's too.
const ID = "ltd.kumo.iridium.app"

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>Iridium</string>
	<key>CFBundleDisplayName</key><string>Iridium</string>
	<key>CFBundleIdentifier</key><string>` + ID + `</string>
	<key>CFBundleExecutable</key><string>iridium</string>
	<key>CFBundleIconFile</key><string>icon</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>%[1]s</string>
	<key>CFBundleVersion</key><string>%[1]s</string>
	<key>LSMinimumSystemVersion</key><string>11.0</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>NSMicrophoneUsageDescription</key><string>语音输入</string>
</dict>
</plist>
`

// Plist is the bundle's Info.plist for version.
func Plist(version string) []byte { return fmt.Appendf(nil, plist, version) }

// ICNS is an icon file of one 1024-pixel PNG (ic10).
func ICNS(png []byte) []byte {
	var b bytes.Buffer
	b.WriteString("icns")
	binary.Write(&b, binary.BigEndian, uint32(8+8+len(png)))
	b.WriteString("ic10")
	binary.Write(&b, binary.BigEndian, uint32(8+len(png)))
	b.Write(png)
	return b.Bytes()
}

// Write puts the Info.plist and the icon for version in the bundle at app (…/Iridium.app),
// each a new file renamed over the old.
func Write(app, version string) error {
	c := filepath.Join(app, "Contents")
	if err := os.MkdirAll(filepath.Join(c, "Resources"), 0o755); err != nil {
		return err
	}
	for _, f := range []struct {
		name string
		b    []byte
	}{{"Info.plist", Plist(version)}, {"Resources/icon.icns", ICNS(Icon)}} {
		p := filepath.Join(c, f.name)
		if err := os.WriteFile(p+".new", f.b, 0o644); err != nil {
			return err
		}
		if err := os.Rename(p+".new", p); err != nil {
			return err
		}
	}
	return nil
}

// Of is the bundle the binary exe is in (…/X.app); "": none.
func Of(exe string) string {
	i := strings.Index(exe, ".app/Contents/MacOS/")
	if i < 0 {
		return ""
	}
	return exe[:i+len(".app")]
}

// Refresh, on a Mac, writes the bundle exe is in for version (Write) and signs it again, whole
// (ad hoc, as a release does): a binary changed in a signed bundle leaves its signature broken,
// and macOS calls the app damaged. Outside a bundle, or elsewhere, nothing.
func Refresh(exe, version string) error {
	app := Of(exe)
	if runtime.GOOS != "darwin" || app == "" {
		return nil
	}
	err := Write(app, version)
	if out, serr := exec.Command("codesign", "--force", "--deep", "-s", "-", "--identifier", ID, app).CombinedOutput(); serr != nil {
		return fmt.Errorf("%v: %s", serr, strings.TrimSpace(string(out)))
	}
	return err
}
