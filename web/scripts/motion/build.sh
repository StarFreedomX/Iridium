#!/bin/sh
# build.sh TREE: a copy of TREE built into /tmp/irperf/out (web, binary, fake claude). TREE untouched.
set -e
TREE=${1:-/home/iridium/kumo/Iridium-perf}
H=/tmp/irperf
rm -rf $H/src $H/out; mkdir -p $H/src $H/out
rsync -a --exclude web/node_modules --exclude .git --exclude .iridium "$TREE"/ $H/src/
ln -s /home/iridium/kumo/Iridium/web/node_modules $H/src/web/node_modules
(cd $H/src/web && npx vite build ${MINIFY:+--minify $MINIFY} >$H/out/web-build.log 2>&1) || { tail -20 $H/out/web-build.log; exit 1; }
cd $H/src
~/.local/bin/go build -o $H/out/iridium ./cmd/iridium
~/.local/bin/go test -c -o $H/out/agents.test ./internal/server
ln -sfn $H/out/agents.test $H/out/claude
echo "built $(cd "$TREE" && git log --oneline -1 2>/dev/null | cut -c1-60) (+ its uncommitted changes)"
