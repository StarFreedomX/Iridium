// burst.mjs ENGINE GAPMS: messages sent fast one after another; per frame, how far the scroll is from the end and where the newest bubble is.
import { chromium, webkit } from "playwright-core";
import fs from "node:fs";
const [engine = "chromium", gap = "180"] = process.argv.slice(2);
const url = `http://127.0.0.1:${fs.readFileSync("/tmp/irperf/run/port", "utf8").trim()}/`;
const ids = Object.fromEntries(fs.readFileSync("/tmp/irperf/run/ids", "utf8").trim().split("\n").map((l) => l.split(" ")));
const b = await (engine === "webkit" ? webkit : chromium).launch(engine === "chromium" ? { executablePath: "/home/iridium/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome", args: ["--no-sandbox"] } : {});
const p = await b.newPage({ viewport: { width: 1100, height: 900 }, serviceWorkers: "block" });
p.on("pageerror", (e) => console.log("ERR", e.message.slice(0, 200)));
await p.goto(url + "?lang=en#/s/" + ids[6]); await p.waitForTimeout(2500);
await p.evaluate(() => {
  window.__b = []; const e = document.querySelector("main [role=log]");
  const f = () => { const col = e.firstElementChild; const rows = [...col.children].filter((r) => r.getBoundingClientRect().height > 0); const last = rows.at(-2) ?? rows.at(-1); const lb = last?.getBoundingClientRect(); const stack = document.querySelector("main textarea").closest(".glass").getBoundingClientRect().top; const op = last ? Math.min(...[last, ...last.querySelectorAll("*")].slice(0, 12).map((x) => +getComputedStyle(x).opacity)) : 1; window.__b.push([Math.round(performance.now()), Math.round(e.scrollHeight - e.clientHeight - e.scrollTop), rows.length, lb ? Math.round(lb.bottom - stack) : 0, Math.round(op * 100) / 100, Math.round(e.scrollTop)]); };
  const ch = new MessageChannel(); ch.port1.onmessage = f; const tick = () => (ch.port2.postMessage(0), requestAnimationFrame(tick)); requestAnimationFrame(tick);
  window.__k = []; addEventListener("keydown", (ev) => ev.key === "Enter" && window.__k.push(Math.round(performance.now())), true);
});
const box = p.locator("main textarea").first(); await box.click();
await p.evaluate(() => (window.__b.length = 0));
for (let i = 0; i < 6; i++) { await p.keyboard.type(String(10 + i)); await p.keyboard.press("Enter"); await p.waitForTimeout(Number(gap)); }
await p.waitForTimeout(2500);
const { B, K, M } = await p.evaluate(() => ({ B: window.__b, K: window.__k, M: (window.__moves || []).filter((m) => !m.who.startsWith("css")).slice(-40) }));
let down = 0, maxGap = 0, hid = 0; for (let i = 1; i < B.length; i++) { if (B[i][5] < B[i - 1][5] - 0.6) down++; maxGap = Math.max(maxGap, B[i][1]); if (B[i][3] > 4) hid++; }
// per send: ms from Enter till a new row is counted, till the scroll is within 2px of the end
const per = K.map((k, i) => { const n0 = B.findLast((x) => x[0] <= k)?.[2] ?? 0; const row = B.find((x) => x[0] > k && x[2] > n0); const rest = B.find((x) => x[0] > (row?.[0] ?? k) && x[1] <= 2); return { row: row ? row[0] - k : null, rest: rest ? rest[0] - k : null }; });
console.log(engine, gap + "ms apart", JSON.stringify({ framesScrollBack: down, maxGapPx: maxGap, framesNewestUnderComposer: hid, per }));
console.log("moves:", [...new Set(M.map((m) => `${m.who} ${m.why}`))].join(", "));
fs.writeFileSync(`/tmp/irperf/burst-${engine}.json`, JSON.stringify({ B, K, M }));
await b.close();
