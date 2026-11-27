// comp.mjs ENGINE: the composer through chats switched in the sidebar, by each frame painted.
import { chromium, webkit } from "playwright-core";
import fs from "node:fs";
const [engine = "chromium", gap = "700"] = process.argv.slice(2);
const url = `http://127.0.0.1:${fs.readFileSync("/tmp/irperf/run/port", "utf8").trim()}/`;
const b = await (engine === "webkit" ? webkit : chromium).launch(engine === "chromium" ? { executablePath: "/home/iridium/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome", args: ["--no-sandbox"] } : {});
const p = await b.newPage({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block" });
p.on("pageerror", (e) => console.log("ERR", e.message.slice(0, 200)));
if (process.argv[4]) { const ms = Number(process.argv[4]); for (const pat of ["**/first*", "**/v1/internal/block.list", "**/v1/internal/sessions/*"]) await p.route(pat, async (r) => { await new Promise((x) => setTimeout(x, ms)); await r.continue().catch(() => {}); }); }
await p.goto(url + "?lang=en"); await p.waitForTimeout(process.argv[4] ? 700 : 2500);
await p.evaluate(() => {
  window.__c = [];
  const f = () => {
    const t = document.querySelector("main textarea"); const box = t?.closest(".glass") ?? t?.parentElement; const r = box?.getBoundingClientRect();
    const keys = box ? [...box.querySelectorAll("button")].map((k) => (k.innerText || k.getAttribute("aria-label") || "").trim().slice(0, 14)).join("|") : "";
    const o = box ? getComputedStyle(box).opacity : "";
    const sig = !t ? "NONE" : `${Math.round(r.top)},${Math.round(r.height)},${Math.round(r.width)} o=${o} ${keys}`;
    const title = (document.querySelector("main header")?.innerText || "").split("\n")[0];
    if (sig !== window.__last) { window.__last = sig; window.__c.push([Math.round(performance.now()), title, sig]); }
  };
  const ch = new MessageChannel(); ch.port1.onmessage = f; const tick = () => (ch.port2.postMessage(0), requestAnimationFrame(tick)); requestAnimationFrame(tick);
});
const rows = p.locator('[data-flip^="s:"]');
const n = await rows.count();
const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 4, 1, 5].filter((i) => i < n);
for (const i of order) { const t = await p.evaluate(() => Math.round(performance.now())); await rows.nth(i).click(); await p.evaluate((t) => window.__c.push([t, "CLICK", ""]), t); await p.waitForTimeout(Number(gap)); }
await p.waitForTimeout(1000);
const C = (await p.evaluate(() => window.__c)).sort((a, b) => a[0] - b[0]);
let last = 0; for (const [t, title, sig] of C) { if (title === "CLICK") { console.log("-- click"); last = t; } else console.log(`  +${t - last}ms ${title.slice(0, 12).padEnd(12)} ${sig.slice(0, 150)}`); }
console.log("NONE frames:", C.filter((c) => c[2] === "NONE").length);
await b.close();
