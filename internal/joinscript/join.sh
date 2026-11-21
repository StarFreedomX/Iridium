#!/bin/sh
# iridium from the Iridium at {{ORIGIN}} (docs/exec.md "一行命令"), run here as the address asked:
#   curl -fsSL {{ORIGIN}}/join | sh               this computer runs agents for it while this terminal stays open
#   curl -fsSL '{{ORIGIN}}/join?install' | sh     the same, installed as the user's service (at login, after reboots)
#   curl -fsSL {{ORIGIN}}/install | sh            an Iridium of this computer's own, installed as the user's service
# It fetches iridium (this Iridium's version, its archive checked there against the release's
# SHA256SUMS) into the cache, again only when that version is another. Joining, a pairing code
# to allow on the Iridium's page comes the first time.
set -eu
case "$(uname -s)" in
Darwin) os=darwin dir="$HOME/Library/Caches/iridium" ;;
Linux) os=linux dir="${XDG_CACHE_HOME:-$HOME/.cache}/iridium" ;;
*) echo "不支持的系统：$(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
x86_64 | amd64) arch=amd64 ;;
arm64 | aarch64) arch=arm64 ;;
*) echo "不支持的架构：$(uname -m)" >&2; exit 1 ;;
esac
exe="$dir/iridium"
want={{WANT}}
if [ -z "$want" ] || [ "$("$exe" version 2>/dev/null || true)" != "$want" ]; then
	mkdir -p "$dir"
	echo "下载 ${want:-iridium}"
	curl -fL --progress-bar -o "$dir/iridium.tar.gz" "{{DOWNLOAD}}iridium-$os-$arch.tar.gz"
	rm -rf "$dir/new"
	mkdir -p "$dir/new"
	tar -xzf "$dir/iridium.tar.gz" -C "$dir/new" ./iridium
	chmod 755 "$dir/new/iridium"
	mv -f "$dir/new/iridium" "$exe"
	rm -rf "$dir/new" "$dir/iridium.tar.gz"
fi
exec "$exe" {{ARGS}}
