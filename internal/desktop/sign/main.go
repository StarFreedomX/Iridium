// Command sign makes the desktop app's macOS release files (scripts/app-bundle.sh), run from the
// repository's root:
//
//	go run ./internal/desktop/sign bundle <binary> <dir> <ver>  Iridium.app around a macOS binary, in dir
//	go run ./internal/desktop/sign zip <app> <zip>              a bundle zipped as it is (signed, its signature kept)
package main

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
)

func main() {
	if len(os.Args) < 2 {
		fail("usage: sign bundle <binary> <dir> <version> | zip <app> <zip>")
	}
	var err error
	switch a := os.Args[2:]; os.Args[1] {
	case "bundle":
		if len(a) != 3 {
			fail("usage: sign bundle <binary> <dir> <version>")
		}
		err = bundle(a[0], a[1], a[2])
	case "zip":
		if len(a) != 2 {
			fail("usage: sign zip <app> <zip>")
		}
		err = zipDir(a[0], a[1])
	default:
		fail("unknown: " + os.Args[1])
	}
	if err != nil {
		fail(err.Error())
	}
}

func fail(s string) {
	fmt.Fprintln(os.Stderr, "sign:", s)
	os.Exit(1)
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>Iridium</string>
	<key>CFBundleDisplayName</key><string>Iridium</string>
	<key>CFBundleIdentifier</key><string>ltd.kumo.iridium.app</string>
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

// bundle writes dir/Iridium.app: the binary, its Info.plist and its icon. Signed after
// (scripts/app-bundle.sh): a bundle whose Info.plist and resources its signature does not cover,
// macOS calls damaged once it was downloaded.
func bundle(bin, dir, version string) error {
	exe, err := os.ReadFile(bin)
	if err != nil {
		return err
	}
	png, err := os.ReadFile("internal/desktop/assets/icon.png") // run from the root
	if err != nil {
		return err
	}
	app := filepath.Join(dir, "Iridium.app", "Contents")
	for _, d := range []string{"MacOS", "Resources"} {
		if err := os.MkdirAll(filepath.Join(app, d), 0o755); err != nil {
			return err
		}
	}
	for _, f := range []struct {
		name string
		mode os.FileMode
		b    []byte
	}{
		{"Info.plist", 0o644, fmt.Appendf(nil, plist, version)},
		{"Resources/icon.icns", 0o644, icns(png)},
		{"MacOS/iridium", 0o755, exe},
	} {
		if err := os.WriteFile(filepath.Join(app, f.name), f.b, f.mode); err != nil {
			return err
		}
	}
	return nil
}

// zipDir zips the directory app (Iridium.app) under its own name, modes kept.
func zipDir(app, out string) error {
	f, err := os.Create(out)
	if err != nil {
		return err
	}
	defer f.Close()
	z := zip.NewWriter(f)
	base := filepath.Dir(app)
	err = filepath.WalkDir(app, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(base, p)
		info, err := d.Info()
		if err != nil {
			return err
		}
		h, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		h.Name = filepath.ToSlash(rel)
		if d.IsDir() {
			h.Name += "/"
			_, err = z.CreateHeader(h)
			return err
		}
		h.Method = zip.Deflate
		w, err := z.CreateHeader(h)
		if err != nil {
			return err
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		_, err = w.Write(b)
		return err
	})
	if err != nil {
		return err
	}
	return z.Close()
}

// icns is an icon file of one 512-pixel PNG (ic09).
func icns(png []byte) []byte {
	var b bytes.Buffer
	b.WriteString("icns")
	binary.Write(&b, binary.BigEndian, uint32(8+8+len(png)))
	b.WriteString("ic09")
	binary.Write(&b, binary.BigEndian, uint32(8+len(png)))
	b.Write(png)
	return b.Bytes()
}
