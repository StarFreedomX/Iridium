#!/bin/sh
# stop.sh: the throwaway server, the proxy and the fake agents' units stopped; state kept in /tmp/irperf/run.
R=/tmp/irperf/run
for f in serve.pid proxy.pid; do [ -f $R/$f ] && kill $(cat $R/$f) 2>/dev/null; rm -f $R/$f; done
systemctl --user list-units --all --no-legend 'iridium-test-hold-irperf-*' 2>/dev/null | awk '{print $1}' | while read u; do systemctl --user stop "$u" 2>/dev/null; done
true
