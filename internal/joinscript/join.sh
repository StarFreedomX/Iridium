#!/bin/sh
# This computer runs agents for the Iridium at {{ORIGIN}} while this terminal stays open
# (docs/exec.md "ir-computer"):   curl -fsSL {{ORIGIN}}/join | sh
# It fetches ir-computer (into the cache, again only when this Iridium's version is another) and
# runs it here: a pairing code to allow on the Iridium's page the first time, then connected till
# Ctrl-C or the window closes. Nothing starts at login.
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
exe="$dir/ir-computer"
want={{WANT}}
if [ -z "$want" ] || [ "$("$exe" version 2>/dev/null || true)" != "$want" ]; then
	mkdir -p "$dir"
	echo "下载 ${want:-ir-computer}"
	curl -fL --progress-bar -o "$exe.new" "{{DOWNLOAD}}ir-computer-$os-$arch"
	chmod 755 "$exe.new"
	mv -f "$exe.new" "$exe"
fi
exec "$exe" {{ARGS}}
