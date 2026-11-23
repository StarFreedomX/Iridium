#!/bin/sh
# setup.sh: a fresh throwaway Iridium from /tmp/irperf/out on a random port, 9 sessions seeded
# (s1, s2 with three ~1.8 MB photos each and a tool picture), a 150 ms-each-way proxy in front.
set -e
H=/tmp/irperf; R=$H/run
sh $H/stop.sh
rm -rf $R; mkdir -p $R/home $R/claude/projects $R/state $R/sock $R/xdgc/iridium $R/xdgs; chmod 700 $R
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
pport=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
echo $port > $R/port; echo $pport > $R/pport
cat > $R/xdgc/iridium/config.json <<EOC
{"listen":"127.0.0.1:$port","socket":"$R/sock/ir.sock","stateDir":"$R/state","claudeHome":"$R/claude","unitPrefix":"iridium-test-hold-irperf-","update":{"url":"off"},"programs":{"claude":"$H/out/claude"}}
EOC
cat > $R/env <<EOE
export HOME=$R/home XDG_CONFIG_HOME=$R/xdgc XDG_STATE_HOME=$R/xdgs IRIDIUM_CONFIG=$R/xdgc/iridium/config.json IRIDIUM_SOCKET=$R/sock/ir.sock
EOE
. $R/env
ln -sfn $H/out/iridium $R/ir
(cd $R && nohup $H/out/iridium serve > $R/serve.log 2>&1 & echo $! > $R/serve.pid)
for i in $(seq 60); do curl -sf -o /dev/null http://127.0.0.1:$port/ && break; sleep 0.25; done
IR=$R/ir
# One session: its turns in order. Three folders of three, so every row shows.
seed() {
  n=$1; dir=$R/home/p$(( (n-1)/3 + 1 )); mkdir -p $dir
  id=$($IR api channel.create _data.agent=claude _data.cwd=$dir _data.text="hello $n" data.name="s$n" --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
  echo "$n $id" >> $R/ids
  $IR api PUT internal/channels/$id/avatar avatar=$(base64 -w0 $H/img/face$((n%10)).png) >/dev/null
  $IR api message.create channel_id=$id _data.text="walk me through it FASTSTREAM" --wait >/dev/null 2>&1 || true
  if [ $n -le 2 ]; then
    $IR api message.create channel_id=$id _data.text="photos of the board" _data.paths:="[\"$H/img/photo$((n-1)).png\",\"$H/img/photo$((n)).png\",\"$H/img/photo$((n+1)).png\"]" --wait >/dev/null 2>&1 || true
    $IR api message.create channel_id=$id _data.text="read the screenshot PICTURE" --wait >/dev/null 2>&1 || true
  fi
  $IR api message.create channel_id=$id _data.text="and the next part" --wait >/dev/null 2>&1 || true
  $IR api message.create channel_id=$id _data.text="end $n" --wait >/dev/null 2>&1 || true
}
: > $R/ids
for n in 9 8 7 6 5 4 3; do seed $n & done; wait
seed 2; seed 1
sort -n $R/ids -o $R/ids
(cd $H && nohup node proxy.mjs $pport $port 0 $R/proxy.log > $R/proxy.out 2>&1 & echo $! > $R/proxy.pid)
sleep 0.5
echo "up: http://127.0.0.1:$pport/ (proxy, 150 ms each way) -> 127.0.0.1:$port; sessions:"; cat $R/ids
