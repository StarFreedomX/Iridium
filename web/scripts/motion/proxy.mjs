// TCP proxy adding DELAY ms each way per chunk (order kept); logs HTTP request lines with time.
import net from "node:net";
import fs from "node:fs";
const [listen, target, delay, logf] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4]), process.argv[5]];
const t0 = Date.now();
const log = (s) => fs.appendFileSync(logf, `${Date.now()} ${s}\n`);
net.createServer((c) => {
  const s = net.connect(target, "127.0.0.1");
  const pipe = (a, b, sniff) => {
    let last = 0;
    a.on("data", (d) => {
      if (sniff) {
        const s = d.toString("latin1");
        for (const m of s.matchAll(/(GET|POST|PUT|PATCH|DELETE) (\S+) HTTP\/1\.1\r\n([\s\S]*?)\r\n\r\n/g)) log(`${m[1]} ${m[2]}${/if-none-match|if-modified-since/i.test(m[3]) ? " cond" : ""}`);
      }
      const at = Math.max(Date.now() + delay, last);
      last = at;
      setTimeout(() => b.write(d), at - Date.now());
    });
    a.on("end", () => setTimeout(() => b.end(), Math.max(0, last - Date.now()) + 1));
    a.on("error", () => b.destroy());
  };
  pipe(c, s, true);
  pipe(s, c, false);
}).listen(listen, "127.0.0.1", () => console.log("proxy up", listen));
