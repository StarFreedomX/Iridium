import { chromium, webkit } from "playwright-core";
import fs from "node:fs";
const [engine = "chromium"] = process.argv.slice(2);
const url = `http://127.0.0.1:${fs.readFileSync("/tmp/irperf/run/port", "utf8").trim()}/`;
const ids = Object.fromEntries(fs.readFileSync("/tmp/irperf/run/ids", "utf8").trim().split("\n").map((l) => l.split(" ")));
const b = await (engine === "webkit" ? webkit : chromium).launch(engine === "chromium" ? { executablePath: "/home/iridium/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome", args: ["--no-sandbox"] } : {});
const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
const p = await ctx.newPage();
const reqs = []; p.on("request", (r) => /avatar/.test(r.url()) && reqs.push(Date.now()));
await ctx.addInitScript(() => {
  window.__fa = []; let last = "";
  const f = () => { const m = document.querySelector("main [role=log]"); if (!m) return; let logo = 0, img = 0, wait = 0, canvas = 0; const sizes = new Set();
    for (const k of m.querySelectorAll('button[aria-label] > span.relative, button.g-press span.relative')) { const c = k.querySelector("canvas"), i = k.querySelector("img"), s = k.querySelector("svg"); if (c) canvas++; else if (i && i.complete && i.naturalWidth) img++; else if (i) wait++; else if (s) logo++; if (i || c) sizes.add(Math.round(k.getBoundingClientRect().width)); }
    const sig = `canvas=${canvas} img=${img} loading=${wait} logo=${logo} sizes=${[...sizes]}`; if (sig !== last) { last = sig; window.__fa.push([Math.round(performance.now()), sig]); } };
  const ch = new MessageChannel(); ch.port1.onmessage = f; const tick = () => (ch.port2.postMessage(0), requestAnimationFrame(tick)); requestAnimationFrame(tick);
});
const show = async (name) => { const F = await p.evaluate(() => window.__fa.splice(0)); console.log(name, "avatar requests:", reqs.splice(0).length); for (const [t, s] of F) console.log("   ", t, s); };
await p.goto(url + "?lang=en#/s/" + ids[4]); await p.waitForTimeout(3000); await show("first load of s4");
await p.evaluate((id) => (location.hash = "#/s/" + id), ids[5]); await p.waitForTimeout(1500); await show("switch to s5 (two agents)");
await p.evaluate((id) => (location.hash = "#/s/" + id), ids[4]); await p.waitForTimeout(1500); await show("back to s4");
await p.reload(); await p.waitForTimeout(3000); await show("reload on s4");
const side = await p.evaluate(() => [...new Set([...document.querySelectorAll('[data-flip^="s:"] canvas, [data-flip^="s:"] img')].map((x) => Math.round(x.getBoundingClientRect().width)))]);
console.log("sidebar face sizes:", side);
await b.close();
