// Frames and long animation frames while an agent streams (fake claude STREAM), Chromium headless.
import { readFileSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
const dir = process.argv[2], turns = +(process.argv[3] ?? 6), profile = process.argv.includes("--profile");
const env = Object.fromEntries(readFileSync(`${dir}/env`, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).replace(/^export /, ""), l.slice(l.indexOf("=") + 1)]));
const BASE = env.IRIDIUM_TEST_BASE.replace(/\/$/, "");
const H = { "content-type": "application/json", "x-requested-with": "XMLHttpRequest", "satori-platform": "local", "satori-user-id": "local" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sat = async (m, b) => { const r = await fetch(`${BASE}/v1/${m}`, { method: "POST", headers: H, body: JSON.stringify(b) }); const t = await r.text(); if (!r.ok) throw new Error(m + t); return t ? JSON.parse(t) : {}; };
const status = async (id) => (await (await fetch(`${BASE}/v1/internal/sessions/${id}`, { headers: H })).json()).status;
const idle = async (id) => { await sleep(300); for (let i = 0; i < 600; i++, await sleep(100)) if (["idle", "waiting"].includes(await status(id).catch(() => ""))) return; throw new Error("not idle"); };
const cwd = `/tmp/cddf-perf/work${Date.now()}`; mkdirSync(cwd, { recursive: true });
const ch = await sat("channel.create", { _data: { agent: "claude", cwd, text: "hello" } });
await idle(ch.id);
for (let i = 0; i < turns; i++) { await sat("message.create", { channel_id: ch.id, content: `seed ${i} FASTSTREAM` }); await idle(ch.id); }
const ff = process.argv.includes("--firefox");
const browser = ff ? await puppeteer.launch({ browser: "firefox", executablePath: "/usr/bin/firefox", headless: true, args: ["--width=1100", "--height=900"] })
  : await puppeteer.launch({ executablePath: process.env.CHROME ?? "/home/iridium/.cache/iridium-sample/browsers/chrome-headless-shell/linux-157.0.8103.38/chrome-headless-shell-linux64/chrome-headless-shell", headless: process.env.CHROME ? true : "shell", args: ["--no-sandbox", "--window-size=1100,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
await page.goto(`${BASE}/#/s/${ch.id}`, { waitUntil: "networkidle2" });
await sleep(1500);
await page.evaluate(() => {
  const w = window; w.__f = []; w.__lo = []; let last = performance.now();
  const tick = (t) => { w.__f.push(t - last); last = t; w.__raf = requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  if (window.PerformanceLongAnimationFrameTiming) new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lo.push({ d: e.duration, block: e.blockingDuration, rs: e.renderStart - e.startTime, sl: e.styleAndLayoutStart ? e.duration - (e.styleAndLayoutStart - e.startTime) : 0, scripts: e.scripts.map((s) => ({ fn: s.sourceFunctionName, inv: s.invoker, src: (s.sourceURL || "").split("/").pop() + ":" + s.sourceCharPosition, d: Math.round(s.duration), forced: Math.round(s.forcedStyleAndLayoutDuration) })) }); }).observe({ type: "long-animation-frame", buffered: false });
});
const cdp = ff ? null : await page.createCDPSession();
if (profile) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start"); }
const expand = process.argv.includes("--expand");
if (cdp) await cdp.send("Performance.enable");
const m0 = cdp && Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
const t0 = Date.now();
if (expand) {
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { const bs = [...document.querySelectorAll("[role=log] [data-seq] button[aria-expanded]")].filter((b) => b.querySelector(".lucide-chevron-right")); bs.at(-1)?.click(); });
    await sleep(700);
  }
} else {
  await sat("message.create", { channel_id: ch.id, content: `go STREAM` });
  await idle(ch.id); await sleep(800);
}
if (cdp) { const m1 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value])); for (const k of ["LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration", "LayoutCount", "RecalcStyleCount"]) console.log(k, (m1[k] - m0[k]).toFixed(3)); }
const ms = Date.now() - t0;
const r = await page.evaluate(() => (cancelAnimationFrame(window.__raf), { f: window.__f, lo: window.__lo }));
const f = r.f.slice(2).sort((a, b) => a - b), q = (p) => f[Math.floor(f.length * p)]?.toFixed(1);
console.log(`stream ${ms}ms, frames ${f.length} (~${(f.length / (ms / 1000)).toFixed(0)} fps), p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${f.at(-1)?.toFixed(0)}; >34ms: ${f.filter((x) => x > 34).length}`);
console.log(`long frames ${r.lo.length}, total ${r.lo.reduce((a, e) => a + e.d, 0).toFixed(0)}ms`);
const agg = {};
for (const e of r.lo) for (const s of e.scripts) { const k = `${s.inv} | ${s.fn} | ${s.src}`; agg[k] ??= { n: 0, d: 0, forced: 0 }; agg[k].n++; agg[k].d += s.d; agg[k].forced += s.forced; }
for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].d - a[1].d).slice(0, 15)) console.log(`${v.d}ms (${v.forced} forced) x${v.n}  ${k}`);
if (profile) {
  const { profile: p } = await cdp.send("Profiler.stop");
  const self = {}; const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const dt = {}; p.samples.forEach((id, i) => (dt[id] = (dt[id] ?? 0) + (p.timeDeltas[i] ?? 0)));
  for (const [id, us] of Object.entries(dt)) { const n = byId.get(+id); const cf = n.callFrame; const k = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber}:${cf.columnNumber}`; self[k] = (self[k] ?? 0) + us; }
  console.log("--- self time");
  for (const [k, us] of Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 45)) console.log(`${(us / 1000).toFixed(0)}ms ${k}`);
}
await browser.close();
