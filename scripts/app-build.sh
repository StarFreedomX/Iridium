#!/bin/sh
# Builds ir-app (app/, docs/app.md) into a directory, all of it from this computer (no cgo: Wails'
# purego backends): ir-app-linux-<arch>, ir-app-windows-amd64.exe, ir-app-darwin-<arch>.zip
# (Iridium.app, signed ad hoc where codesign or rcodesign is). With IR_APP_SIGN_KEY (app/release keygen) also update.json and its signature, the
# release an app updates from; IR_APP_UPDATE_KEY (its public half) is built in, else the app does
# not update itself.
#
#   scripts/app-build.sh 0.1.0 dist-app
set -eu
cd "$(dirname "$0")/../app"
version=${1:?usage: scripts/app-build.sh <version> <dir>}
out=${2:?usage: scripts/app-build.sh <version> <dir>}
GO=${GO:-go}
command -v "$GO" >/dev/null 2>&1 || GO=$HOME/.local/bin/go
mkdir -p "$out"
out=$(cd "$out" && pwd)
flags="-s -w -X github.com/kumoSleeping/iridium/internal/version.Version=$version -X main.updateKey=${IR_APP_UPDATE_KEY:-}"
build() { # os arch tags file
	echo "app-build: $1/$2"
	GOOS=$1 GOARCH=$2 CGO_ENABLED=0 "$GO" build -tags "$3" -trimpath -ldflags "$flags" -o "$4" .
}
for a in amd64 arm64; do build linux $a purego,gtk3 "$out/ir-app-linux-$a"; done
build windows amd64 "" "$out/ir-app-windows-amd64.exe"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# The whole bundle signed (ad hoc, no Apple ID): its Info.plist and resources covered. Unsigned,
# macOS calls a downloaded one damaged, with no way to open it. codesign on a Mac, else rcodesign.
sign() {
	if command -v codesign >/dev/null 2>&1; then
		codesign --force --deep -s - --identifier ltd.kumo.iridium.app "$1"
	elif command -v rcodesign >/dev/null 2>&1; then
		rcodesign sign "$1"
	else
		echo "app-build: WARNING: no codesign or rcodesign: $1 unsigned (macOS will call it damaged)" >&2
	fi
}
for a in arm64 amd64; do
	build darwin $a purego "$tmp/ir-app"
	rm -rf "$tmp/$a" && mkdir -p "$tmp/$a"
	"$GO" run ./release bundle "$tmp/ir-app" "$tmp/$a" "$version"
	sign "$tmp/$a/Iridium.app"
	"$GO" run ./release zip "$tmp/$a/Iridium.app" "$out/ir-app-darwin-$a.zip"
done
if [ -n "${IR_APP_SIGN_KEY:-}" ]; then
	"$GO" run ./release manifest "$version" "$out"
fi
ls -l "$out"
