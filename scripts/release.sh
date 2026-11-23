#!/bin/sh
# Builds the release assets into a directory (the web app and the desktop app's pages must be built
# already: npm run build and npm run build:app in web/): for each platform a static, stripped binary
# packed as iridium-<os>-<arch>.tar.gz (the binary, README.md, LICENSE, icon.png), on Linux and Windows the
# same binary bare as iridium-app-<os>-<arch>[.exe] (the desktop app's download and update; macOS's
# is a bundle, scripts/app-bundle.sh), the official QQ plugin as iridium-qq-<os>-<arch>.tar.gz
# (not Windows), install.sh and install.ps1 (the install script installing this release), ir-computer as
# bare binaries ir-computer-<os>-<arch>[.exe], SHA256SUMS, and notes.md: the commits since the last tag (what the
# settings page shows), then after the marker internal/update.NotesEnd the sizes and how to install.
#
#   scripts/release.sh v1.2.0 dist          both steps
#   scripts/release.sh v1.2.0 dist build    the binaries and archives, a row of the notes each in dist/rows
#   scripts/release.sh v1.2.0 dist finish   from a dist the builds filled (release.yml: one per
#                                           runner, put together): notes.md, SHA256SUMS, install scripts
#   PLATFORMS="linux/amd64 linux/arm64"   which to build (default Linux, macOS and Windows, amd64 and arm64)
#   COMPUTER_PLATFORMS="windows/amd64"    which ir-computer to build (default those and Windows)
#   JOBS=3                                how many platforms are built at once
#   TAR=gtar                              a GNU tar (a Mac's own tar has no --owner)
set -eu
cd "$(dirname "$0")/.."
version=${1:?usage: scripts/release.sh <version> <dir> [build|finish]}
out=${2:?usage: scripts/release.sh <version> <dir> [build|finish]}
step=${3:-all}
GO=${GO:-go}
command -v "$GO" >/dev/null 2>&1 || GO=$HOME/.local/bin/go
TAR=${TAR:-tar}
mkdir -p "$out"
out=$(cd "$out" && pwd)
size() { wc -c <"$1" | tr -d ' '; }
mib() { awk -v n="$1" 'BEGIN { printf "%.1f MiB", n / 1048576 }'; }
platforms=${PLATFORMS:-linux/amd64 linux/arm64 darwin/arm64 darwin/amd64 windows/amd64 windows/arm64}
computers=${COMPUTER_PLATFORMS:-windows/amd64 windows/arm64 darwin/arm64 darwin/amd64 linux/amd64 linux/arm64}
rows=$out/rows

build() {
	if [ ! -f internal/webui/dist/index.html ]; then
		echo "release: no web build in internal/webui/dist (run npm run build in web/)" >&2
		exit 1
	fi
	if [ ! -f internal/desktop/assets/ui/index.html ]; then
		echo "release: no build of the desktop app's pages (run npm run build:app in web/)" >&2
		exit 1
	fi
	ldflags="-s -w -X github.com/kumoSleeping/iridium/internal/version.Version=$version -X github.com/egoist/mygo.production=1"
	# The platforms side by side, each one's builds in turn (they share what is compiled for it); one
	# at a time they took most of the release's time. A row of the notes each, put in order once all
	# are done.
	mkdir -p "$rows"
	platform() { # os arch: Iridium's archive, its desktop app's download, the QQ plugin
		os=$1 arch=$2
		name=iridium-$os-$arch
		ext=
		[ "$os" = windows ] && ext=.exe
		stage=$(mktemp -d)
		CGO_ENABLED=0 GOOS=$os GOARCH=$arch "$GO" build -trimpath -ldflags "$ldflags" \
			-o "$stage/iridium$ext" ./cmd/iridium
		cp README.md "$stage/" 2>/dev/null || true
		cp LICENSE "$stage/" 2>/dev/null || true
		cp internal/desktop/assets/icon.png "$stage/" # the install script's menu entry on a Linux desktop
		"$TAR" -C "$stage" -czf "$out/$name.tar.gz" --owner=0 --group=0 --numeric-owner .
		echo "| $os/$arch | $(mib "$(size "$stage/iridium$ext")") | $(mib "$(size "$out/$name.tar.gz")") |" >"$rows/iridium-$os-$arch"
		# The desktop app's download on Linux and Windows: the binary itself.
		[ "$os" = darwin ] || cp "$stage/iridium$ext" "$out/iridium-app-$os-$arch$ext"
		rm -rf "$stage"
		[ "$os" = windows ] && return 0
		# The official QQ plugin: not in Iridium's archive; 终端管理 installs it from here when asked.
		stage=$(mktemp -d)
		CGO_ENABLED=0 GOOS=$os GOARCH=$arch "$GO" build -trimpath \
			-ldflags "-s -w -X github.com/kumoSleeping/iridium/internal/version.Version=$version" \
			-o "$stage/iridium-qq" ./cmd/iridium-qq
		"$TAR" -C "$stage" -czf "$out/iridium-qq-$os-$arch.tar.gz" --owner=0 --group=0 --numeric-owner .
		rm -rf "$stage"
}
# ir-computer: the program another computer runs to join (docs/exec.md), a bare binary each, so a
# one-line script fetches and runs it. Windows too.
computer() { # os arch
	os=$1 arch=$2
	ext=
	[ "$os" = windows ] && ext=.exe
	name=ir-computer-$os-$arch$ext
	CGO_ENABLED=0 GOOS=$os GOARCH=$arch "$GO" build -trimpath \
		-ldflags "-s -w -X github.com/kumoSleeping/iridium/internal/version.Version=$version" \
		-o "$out/$name" ./cmd/ir-computer
	echo "| $os/$arch | $(mib "$(size "$out/$name")") |" >"$rows/computer-$os-$arch"
}
# At most JOBS platforms at once (default 3): each build runs compilers on every core already, and
# six at once ran a runner's memory out (a build killed without a word).
jobs=${JOBS:-3}
running= # pid:platform of the builds under way, oldest first
failed=
reap() { # the oldest build under way
	first=${running%% *}
	running=${running#"$first"}
	running=${running# }
	wait "${first%%:*}" || failed="$failed ${first#*:}"
}
for p in $(printf '%s\n' $platforms $computers | awk '!seen[$0]++'); do
	(
		case " $platforms " in *" $p "*) platform "${p%/*}" "${p#*/}" ;; esac
		case " $computers " in *" $p "*) computer "${p%/*}" "${p#*/}" ;; esac
	) &
	running="${running:+$running }$!:$p"
	set -- $running
	[ $# -lt "$jobs" ] || reap
done
while [ -n "$running" ]; do reap; done
[ -z "$failed" ] || { echo "release: the build failed for$failed" >&2; exit 1; }
}

finish() {
	prev=$(git describe --tags --abbrev=0 "$version^" 2>/dev/null || true)
	{
		git log --no-merges --format='- %s' "${prev:+$prev..}HEAD" 2>/dev/null | head -50
		echo
		echo "<!-- iridium:assets -->"
		echo
		echo "| 平台 | 二进制 | 下载（tar.gz） |"
		echo "|---|---|---|"
	} >"$out/notes.md"
	for p in $platforms; do
		cat "$rows/iridium-${p%/*}-${p#*/}" >>"$out/notes.md" || { echo "release: no build for $p" >&2; exit 1; }
	done
	{
		echo
		echo "| ir-computer | 二进制 |"
		echo "|---|---|"
	} >>"$out/notes.md"
	for p in $computers; do
		cat "$rows/computer-${p%/*}-${p#*/}" >>"$out/notes.md" || { echo "release: no ir-computer for $p" >&2; exit 1; }
	done
	rm -rf "$rows"
	(cd "$out" && sha256sum iridium-*.tar.gz iridium-app-* ir-computer-* >SHA256SUMS)
	# The install script as this release's own assets (internal/joinscript): installing this release
	# from GitHub; an Iridium serves the same script with its own version.
	tag="v${version#v}"
	for f in install.sh install.ps1; do
		sed -e "s|{{BASE}}|https://github.com/kumoSleeping/Iridium/releases/download/$tag/|g" \
			-e "s|{{RELEASE}}|$tag|g" -e "s|{{ORIGIN}}||g" "internal/joinscript/$f" >"$out/$f"
	done
	{
		echo
		echo '桌面应用：macOS 下载 iridium-app-darwin-arm64.zip，Windows 下载 iridium-app-windows-amd64.exe，Linux 下载 iridium-app-linux-amd64；打开后直接进入本机的 Iridium。'
		echo
		echo '安装（macOS、Linux）：`curl -fsSL https://github.com/kumoSleeping/Iridium/releases/latest/download/install.sh | sh`，之后 `ir start` 本机运行；Windows：`irm https://github.com/kumoSleeping/Iridium/releases/latest/download/install.ps1 | iex`。'
		echo
		echo '只装服务器、不用脚本：`tar xzf iridium-linux-amd64.tar.gz && ./iridium ir start`（macOS 用 iridium-darwin-arm64.tar.gz）；之后自动更新。'
	} >>"$out/notes.md"
	cat "$out/notes.md"
}

case $step in
all) build && finish ;;
build) build ;;
finish) finish ;;
*) echo "usage: scripts/release.sh <version> <dir> [build|finish]" >&2; exit 2 ;;
esac
