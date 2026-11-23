#!/bin/sh
# What CI and release.yml check, on a clean checkout of HEAD, before a push: a file left out of a
# commit (untracked, or caught by .gitignore) fails here, not on GitHub. Then a release is one push:
#
#   scripts/preflight.sh && git push origin main vX.Y.Z
#
# release.yml runs the same checks before it publishes, so there is no CI run to wait for first.
# The checkout is kept between runs (PREFLIGHT_DIR, default ~/.cache/iridium-preflight), reset to
# HEAD and cleaned each time: at one path, Go's test cache skips the packages that did not change,
# and npm ci runs only when web/package-lock.json did. The Go checks run at once, beside the web's.
set -eu
cd "$(dirname "$0")/.."
GO=${GO:-go}
command -v "$GO" >/dev/null 2>&1 || GO=$HOME/.local/bin/go
repo=$(pwd)

# Not in HEAD, so neither checked nor shipped.
dirty=$(git status --porcelain)
[ -z "$dirty" ] || { echo "preflight: not committed (not checked, not shipped):"; echo "$dirty"; }
# Test data .gitignore keeps out (a fake package's node_modules/): the checkout below would miss it.
ignored=$(git status --porcelain --ignored=matching | sed -n 's/^!! //p' | grep '/testdata/' || true)
[ -z "$ignored" ] || { echo "preflight: test data ignored by .gitignore:"; echo "$ignored"; }

dir=${PREFLIGHT_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/iridium-preflight}
mkdir -p "$dir"
# One run at a time in it.
if command -v flock >/dev/null 2>&1; then
	exec 9>"$dir/.lock"
	flock 9
fi
src=$dir/src
[ -d "$src/.git" ] || git clone -q --no-checkout "$repo" "$src"
cd "$src"
git fetch -q "$repo" HEAD
git checkout -q -f --detach FETCH_HEAD
# Everything not in HEAD goes, but web/node_modules (kept for npm ci below to skip).
git clean -q -ffdx -e /web/node_modules/

logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT
lock=$(git hash-object web/package-lock.json)
(cd web && {
	[ "$(cat node_modules/.preflight-lock 2>/dev/null)" = "$lock" ] ||
		{ npm ci --no-audit --no-fund --prefer-offline --silent && echo "$lock" >node_modules/.preflight-lock; }
} && npm run check --silent && npm run build --silent >/dev/null && npm run build:app --silent >/dev/null) \
	>"$logs/web" 2>&1 &
web=$!
GO="$GO" scripts/check-types.sh >"$logs/types" 2>&1 &
types=$!
"$GO" vet ./... >"$logs/vet-linux" 2>&1 &
vl=$!
GOOS=darwin GOARCH=arm64 "$GO" vet ./... >"$logs/vet-darwin" 2>&1 &
vd=$!
GOOS=windows GOARCH=amd64 "$GO" vet ./... >"$logs/vet-windows" 2>&1 &
vw=$!
"$GO" test ./... >"$logs/test" 2>&1 &
test=$!

failed=0
check() { # name pid
	wait "$2" && return 0
	failed=1
	echo "preflight: $1:"
	grep -v '^ok\|no test files' "$logs/$1" || true
}
check types $types
check vet-linux $vl
check vet-darwin $vd
check vet-windows $vw
check test $test
check web $web
[ $failed = 0 ] || exit 1
echo "preflight: ok at $(git rev-parse --short HEAD)"
