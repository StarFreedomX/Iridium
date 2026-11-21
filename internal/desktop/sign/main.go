// Command release makes ir-app's release files (scripts/app-build.sh): the macOS bundle, and the
// signed manifest an app updates from (docs/app.md "更新").
//
//	go run ./release keygen                       a key: the private half (base64) out, the public on stderr
//	go run ./release bundle <binary> <dir> <ver>  Iridium.app around a macOS binary, in dir
//	go run ./release zip <app> <zip>              a bundle zipped as it is (signed, its signature kept)
//	go run ./release manifest <ver> <dir>         update.json and update.json.sig for the files in dir,
//	                                              signed with IR_APP_SIGN_KEY (the private half, base64)
package main

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

func main() {
	if len(os.Args) < 2 {
		fail("usage: release keygen | bundle <binary> <dir> <version> | zip <app> <zip> | manifest <version> <dir>")
	}
	var err error
	switch a := os.Args[2:]; os.Args[1] {
	case "keygen":
		pub, priv, _ := ed25519.GenerateKey(nil)
		fmt.Println(base64.StdEncoding.EncodeToString(priv.Seed()))
		fmt.Fprintln(os.Stderr, "public:", base64.StdEncoding.EncodeToString(pub))
	case "bundle":
		if len(a) != 3 {
			fail("usage: release bundle <binary> <dir> <version>")
		}
		err = bundle(a[0], a[1], a[2])
	case "zip":
		if len(a) != 2 {
			fail("usage: release zip <app> <zip>")
		}
		err = zipDir(a[0], a[1])
	case "manifest":
		if len(a) != 2 {
			fail("usage: release manifest <version> <dir>")
		}
		err = manifest(a[0], a[1])
	default:
		fail("unknown: " + os.Args[1])
	}
	if err != nil {
		fail(err.Error())
	}
}

func fail(s string) {
	fmt.Fprintln(os.Stderr, "release:", s)
	os.Exit(1)
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>Iridium</string>
	<key>CFBundleDisplayName</key><string>Iridium</string>
	<key>CFBundleIdentifier</key><string>ltd.kumo.iridium.app</string>
	<key>CFBundleExecutable</key><string>ir-app</string>
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
// (scripts/app-build.sh): a bundle whose Info.plist and resources its signature does not cover,
// macOS calls damaged once it was downloaded.
func bundle(bin, dir, version string) error {
	exe, err := os.ReadFile(bin)
	if err != nil {
		return err
	}
	png, err := os.ReadFile("assets/icon.png") // run from app/
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
		{"MacOS/ir-app", 0o755, exe},
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

type artifact struct {
	OS     string `json:"os"`
	Arch   string `json:"arch"`
	URL    string `json:"url"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

var named = regexp.MustCompile(`^ir-app-(darwin|linux|windows)-(amd64|arm64)(\.zip|\.exe)?$`)

// manifest writes dir/update.json, listing dir's ir-app-<os>-<arch>[.zip|.exe], and its signature.
func manifest(version, dir string) error {
	seed, err := base64.StdEncoding.DecodeString(strings.TrimSpace(os.Getenv("IR_APP_SIGN_KEY")))
	if err != nil || len(seed) != ed25519.SeedSize {
		return fmt.Errorf("IR_APP_SIGN_KEY is not a key (release keygen)")
	}
	key := ed25519.NewKeyFromSeed(seed)
	ents, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var files []artifact
	for _, e := range ents {
		m := named.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		f, err := os.Open(filepath.Join(dir, e.Name()))
		if err != nil {
			return err
		}
		h := sha256.New()
		n, err := io.Copy(h, f)
		f.Close()
		if err != nil {
			return err
		}
		files = append(files, artifact{OS: m[1], Arch: m[2], URL: e.Name(), Size: n, SHA256: hex.EncodeToString(h.Sum(nil))})
	}
	if len(files) == 0 {
		return fmt.Errorf("no ir-app files in %s", dir)
	}
	body, err := json.MarshalIndent(map[string]any{
		"app": "ir-app", "version": strings.TrimPrefix(version, "v"), "published": time.Now().UTC().Format(time.RFC3339), "files": files,
	}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "update.json"), body, 0o644); err != nil {
		return err
	}
	sig := base64.StdEncoding.EncodeToString(ed25519.Sign(key, body))
	return os.WriteFile(filepath.Join(dir, "update.json.sig"), []byte(sig+"\n"), 0o644)
}
