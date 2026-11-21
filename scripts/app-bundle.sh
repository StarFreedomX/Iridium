#!/bin/sh
# The desktop app's macOS downloads (docs/app.md "构建"), from a directory scripts/release.sh
# filled: for each iridium-darwin-<arch>.tar.gz there, Iridium.app around its binary, signed whole
# (ad hoc, no Apple ID: codesign on a Mac, else rcodesign), zipped as iridium-app-darwin-<arch>.zip.
# Then, with IR_APP_SIGN_KEY (go run ./internal/desktop/sign keygen), update.json and its
# signature over every iridium-app-* there: the manifest the app updates from.
#
#   scripts/app-bundle.sh v1.2.0 dist
set -eu
cd "$(dirname "$0")/.."
version=${1:?usage: scripts/app-bundle.sh <version> <dir>}
out=${2:?usage: scripts/app-bundle.sh <version> <dir>}
GO=${GO:-go}
command -v "$GO" >/dev/null 2>&1 || GO=$HOME/.local/bin/go
out=$(cd "$out" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# Unsigned, or its Info.plist and resources not covered, macOS calls a downloaded bundle damaged,
# with no way to open it.
sign() {
	if command -v codesign >/dev/null 2>&1; then
		codesign --force --deep -s - --identifier ltd.kumo.iridium.app "$1"
	elif command -v rcodesign >/dev/null 2>&1; then
		rcodesign sign "$1"
	else
		echo "app-bundle: no codesign or rcodesign: no macOS app (unsigned, macOS calls it damaged)" >&2
		return 1
	fi
}
for a in arm64 amd64; do
	[ -f "$out/iridium-darwin-$a.tar.gz" ] || continue
	mkdir -p "$tmp/$a"
	tar -xzf "$out/iridium-darwin-$a.tar.gz" -C "$tmp/$a" ./iridium
	"$GO" run ./internal/desktop/sign bundle "$tmp/$a/iridium" "$tmp/$a" "$version"
	sign "$tmp/$a/Iridium.app" || continue
	"$GO" run ./internal/desktop/sign zip "$tmp/$a/Iridium.app" "$out/iridium-app-darwin-$a.zip"
	# Its sum in the release's SHA256SUMS, which the install script checks it against.
	if [ -f "$out/SHA256SUMS" ]; then
		grep -v " iridium-app-darwin-$a.zip\$" "$out/SHA256SUMS" >"$tmp/sums" || true
		(cd "$out" && shasum -a 256 "iridium-app-darwin-$a.zip") >>"$tmp/sums"
		cp "$tmp/sums" "$out/SHA256SUMS"
	fi
	echo "app-bundle: iridium-app-darwin-$a.zip"
done
if [ -n "${IR_APP_SIGN_KEY:-}" ]; then
	"$GO" run ./internal/desktop/sign manifest "$version" "$out"
	echo "app-bundle: update.json"
fi
