import { chromium, webkit } from "playwright-core";
import fs from "node:fs";
const [engine = "chromium"] = process.argv.slice(2);
const H = "/tmp/irperf", R = `${H}/run`;
const url = `http://127.0.0.1:${fs.readFileSync(`${R}/port`, "utf8").trim()}/`;
const ids = Object.fromEntries(fs.readFileSync(`${R}/ids`, "utf8").trim().split("\n").map((l) => l.split(" ")));
const S3 = ids[3];
const first = fs.readFileSync(`${H}/data/first.json`, "utf8"), members = fs.readFileSync(`${H}/data/members.json`, "utf8");
const face = fs.readFileSync(`${H}/img/face3.png`);
const opts = { viewport: { width: 1366, height: 964 }, headless: true, serviceWorkers: "block" };
if (engine === "chromium") Object.assign(opts, { executablePath: "/home/iridium/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome", args: ["--no-sandbox"] });
const b = await (engine === "webkit" ? webkit : chromium).launch(opts);
const p = await b.newPage(opts);
p.on("pageerror", (e) => console.log("ERR", e.message.slice(0, 300)));
await p.route(new RegExp(`/v1/internal/sessions/${S3}/first`), (r) => r.fulfill({ contentType: "application/json", body: first }));
await p.route(new RegExp(`/v1/internal/channels/${S3}/members$`), (r) => r.request().method() === "GET" ? r.fulfill({ contentType: "application/json", body: members }) : r.continue());
await p.route(/\/v1\/internal\/channels\/[^/]+\/(a|b)(\?|$)/, (r) => r.fulfill({ contentType: "image/png", body: face }));
await p.route(/\/files\/[^/]+\/thumb/, (r) => r.fulfill({ contentType: "image/png", body: face }));
await p.goto(url + "#/s/" + S3); await p.waitForTimeout(3000);
await p.screenshot({ path: `${H}/win-${engine}.png` });
// Every frame: a row seen and where it is; a jump is its place changing by more than the scroll did.
await p.evaluate(() => {
  const el = document.querySelector("main [role=log]"); const col = el.firstElementChild;
  window.__j = []; let ref = null, y = 0, top = el.scrollTop;
  const f = () => {
    const now = el.scrollTop;
    if (ref && ref.isConnected) { const ny = ref.getBoundingClientRect().top; if (Math.abs(ny - y) > 450) window.__j.push([Math.round(performance.now()), Math.round(ny - y), col.children.length]); }
    const mid = el.getBoundingClientRect().top + el.clientHeight / 2;
    ref = [...col.children].find((r) => { const b = r.getBoundingClientRect(); return b.top <= mid && b.bottom >= mid; }) ?? col.lastElementChild;
    y = ref.getBoundingClientRect().top; top = el.scrollTop;
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
const st = () => p.evaluate(() => { const el = document.querySelector("main [role=log]"); return { rows: el.firstElementChild.children.length, top: Math.round(el.scrollTop), h: el.scrollHeight }; });
console.log("open", JSON.stringify(await st()));
await p.mouse.move(700, 500);
const log = [];
for (let i = 0; i < 120; i++) { await p.mouse.wheel(0, -400); await p.waitForTimeout(40); if (i % 15 === 14) log.push(JSON.stringify(await st())); }
await p.waitForTimeout(800);
console.log(log.join("\n")); console.log("end", JSON.stringify(await st()));
console.log("jumps", JSON.stringify(await p.evaluate(() => window.__j.slice(0, 30))), await p.evaluate(() => window.__j.length));
await b.close();
