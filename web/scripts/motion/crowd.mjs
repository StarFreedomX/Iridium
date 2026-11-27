// crowd.mjs ENGINE: four agents called at once; every row's place in the column each frame (the scroll taken out).
import { chromium, webkit } from "playwright-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [engine = "chromium"] = process.argv.slice(2);
const R = "/tmp/irperf/run";
const url = `http://127.0.0.1:${fs.readFileSync(`${R}/port`, "utf8").trim()}/`;
const ids = Object.fromEntries(fs.readFileSync(`${R}/ids`, "utf8").trim().split("\n").map((l) => l.split(" ")));
const env = Object.fromEntries(fs.readFileSync(`${R}/env`, "utf8").replace("export ", "").trim().split(" ").map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]));
const ir = (...a) => execFileSync(`${R}/ir`, a, { env: { ...process.env, ...env }, encoding: "utf8" });
const b = await (engine === "webkit" ? webkit : chromium).launch(engine === "chromium" ? { executablePath: "/home/iridium/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome", args: ["--no-sandbox"] } : {});
const p = await b.newPage({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block" });
p.on("pageerror", (e) => console.log("ERR", e.message.slice(0, 200)));
await p.goto(url + "?lang=en#/s/" + ids[3]); await p.waitForTimeout(3000);
await p.evaluate(() => {
  const e = document.querySelector("main [role=log]"); window.__r = []; let last = "";
  const f = () => { const col = e.firstElementChild; const c = col.getBoundingClientRect(); const rows = [...col.children].filter((r) => r.dataset.flip).slice(-14).map((r) => { const b = r.getBoundingClientRect(); return [r.dataset.flip.slice(0, 12), Math.round((b.top - c.top) * 2) / 2, Math.round(b.height), r.className.includes("g-depart") ? 1 : 0]; }); const sig = JSON.stringify(rows); if (sig !== last) { last = sig; window.__r.push([Math.round(performance.now()), rows]); } };
  const ch = new MessageChannel(); ch.port1.onmessage = f; const tick = () => (ch.port2.postMessage(0), requestAnimationFrame(tick)); requestAnimationFrame(tick);
});
ir("api", "message.create", `channel_id=${ids[3]}`, "content=@Lin @Hajimi @Fish @Pi1 walk me through it STREAM");
await p.waitForTimeout(16000);
const { F, M } = await p.evaluate(() => ({ F: window.__r, M: (window.__moves || []).filter((m) => !m.who.startsWith("css")) }));
// per row: frames it went down / up in the column, how often it turned, and the order's changes
const per = {}; let orders = [], lastOrder = "";
for (let i = 0; i < F.length; i++) { const [t, rows] = F[i]; const order = rows.map((r) => r[0]).join(" "); if (order !== lastOrder) { orders.push([t, rows.filter((r) => r[0].startsWith("at:") || r[0] === "work").map((r) => r[0].slice(0, 8)).join(" | ")]); lastOrder = order; }
  for (const [k, y] of rows) { const s = (per[k] ??= { y, up: 0, down: 0, turns: 0, dir: 0, path: 0 }); const d = y - s.y; if (Math.abs(d) >= 1) { s.path += Math.abs(d); d > 0 ? s.down++ : s.up++; const g = Math.sign(d); if (s.dir && g !== s.dir) s.turns++; s.dir = g; } s.y = y; } }
console.log(engine, "frames", F.length, "reorders played", M.filter((m) => m.who === "moves.play").length, "order changes", orders.length);
for (const [k, s] of Object.entries(per)) if (s.turns || s.down + s.up > 0) console.log("  ", k.padEnd(13), `up ${s.up} down ${s.down} turns ${s.turns} path ${Math.round(s.path)}px`);
console.log("box order over time:"); for (const [t, o] of orders.slice(0, 40)) console.log("  ", t, o);
fs.writeFileSync(`/tmp/irperf/crowd-${engine}.json`, JSON.stringify({ F, M }));
await b.close();
