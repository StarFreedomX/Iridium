import { chromium } from "playwright-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const H = "/tmp/irperf", R = `${H}/run`;
const url = `http://127.0.0.1:${fs.readFileSync(`${R}/port`, "utf8").trim()}/`;
const ids = Object.fromEntries(fs.readFileSync(`${R}/ids`, "utf8").trim().split("\n").map((l) => l.split(" ")));
const S = ids[5];
const env = Object.fromEntries(fs.readFileSync(`${R}/env`, "utf8").replace("export ", "").trim().split(" ").map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]));
const ir = (...a) => execFileSync(`${R}/ir`, a, { env: { ...process.env, ...env }, encoding: "utf8" });
const b = await chromium.launch({ executablePath: "/home/iridium/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
p.on("pageerror", (e) => console.log("ERR", e.message.slice(0, 300)));
await p.goto(url + "#/s/" + S); await p.waitForTimeout(2500);
const lines = () => p.evaluate(() => [...document.querySelectorAll("main [role=log] > div > *")].map((r) => (r.getAttribute("data-flip") || "").slice(0, 30) + " | " + (r.innerText || "").replace(/\s+/g, " ").slice(0, 70)).slice(-7));
const tag = "probe-" + Date.now();
await p.evaluate((tag) => {
  const el = document.querySelector("main [role=log]");
  window.__f = []; let ref = null;
  const f = () => {
    if (!ref || !ref.isConnected) ref = [...el.querySelectorAll("[data-seq]")].reverse().find((r) => r.innerText.includes(tag)) ?? null;
    const col = el.firstElementChild;
    const y = ref ? Math.round(ref.getBoundingClientRect().top * 10) / 10 : null;
    let an = "";
    if (ref && window.__y != null && y > window.__y + 0.6) { const got = []; for (let n = ref; n && n !== el.parentElement; n = n.parentElement) for (const a of n.getAnimations()) got.push((n.getAttribute("data-flip") || n.tagName.toLowerCase() + "." + String(n.className).split(" ")[0]).slice(0, 18) + ":" + (a.animationName || a.transitionProperty || (a.effect.getKeyframes()[0] ? Object.keys(a.effect.getKeyframes()[0]).filter((k) => !["offset", "easing", "composite", "computedOffset"].includes(k)).join("+") : "?")) + "@" + Math.round(a.currentTime ?? -1) + "/" + Math.round(a.effect.getTiming().duration)); an = got.join(" "); }
    window.__y = y;
    window.__f.push([Math.round(performance.now()), y, Math.round(el.scrollTop), col.offsetHeight, col.children.length, an]);
  };
  const ch = new MessageChannel();
  ch.port1.onmessage = f;
  const tick = () => (ch.port2.postMessage(0), requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}, tag);
ir("api", "message.create", `channel_id=${S}`, `content=@Bee ${tag} walk me through it STREAM`);
await p.waitForTimeout(13000);
const F = await p.evaluate(() => window.__f);
// The message's place frame by frame: it only ever goes up as the agent's turn grows under it.
let rev = [], lastY = null, dir = 0, moves = 0;
const M = await p.evaluate(() => window.__moves ?? []);
const eps = [];
for (const [t, y, top, h, n, an] of F) { if (y === null) continue; if (lastY !== null && y - lastY > 0.6) { const e = eps.at(-1); if (e && t - e.to < 60) (e.to = t, e.px += y - lastY, an && e.an.add(an)); else eps.push({ from: t, to: t, px: y - lastY, an: new Set(an ? [an] : []) }); } lastY = y; }
lastY = null;
for (const e of eps) { console.log(`\nDOWN ${Math.round(e.px)}px  ${e.from}..${e.to}`); for (const m of M.filter((m) => m.t >= e.from - 450 && m.t <= e.to + 20)) console.log("   " + JSON.stringify(m)); for (const a of [...e.an].slice(0, 3)) console.log("   on it: " + a.slice(0, 300)); }
console.log("\nall moves by who/why:", JSON.stringify(Object.entries(M.reduce((o, m) => ((o[m.who + " " + m.why] = (o[m.who + " " + m.why] ?? 0) + 1), o), {}))));
for (const [t, y, top, h, n] of F) {
  if (y === null) continue;
  if (lastY !== null && Math.abs(y - lastY) > 0.6) { const d = Math.sign(y - lastY); moves++; if (d > 0) rev.push([t, Math.round(y - lastY), n]); dir = d; }
  lastY = y;
}
const ys = F.filter((f) => f[1] !== null);
console.log(JSON.stringify({ frames: F.length, moves, down: rev.length, downs: rev.slice(0, 40), from: ys[0]?.[1], to: ys.at(-1)?.[1], rowsFromTo: [F[0][4], F.at(-1)[4]] }));
fs.writeFileSync(`${H}/frames-${process.argv[2] || "x"}.json`, JSON.stringify(F));
await b.close();
