// Sent from the composer: each frame, where my message is, the scroll, the room, the reply's end.
import { readFileSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
const dir = process.argv[2], what = process.argv[3] ?? "go STREAM";
const env = Object.fromEntries(readFileSync(`${dir}/env`, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).replace(/^export /, ""), l.slice(l.indexOf("=") + 1)]));
const BASE = env.IRIDIUM_TEST_BASE.replace(/\/$/, "");
const H = { "content-type": "application/json", "x-requested-with": "XMLHttpRequest", "satori-platform": "local", "satori-user-id": "local" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sat = async (m, b) => { const r = await fetch(`${BASE}/v1/${m}`, { method: "POST", headers: H, body: JSON.stringify(b) }); const t = await r.text(); return t ? JSON.parse(t) : {}; };
const status = async (id) => (await (await fetch(`${BASE}/v1/internal/sessions/${id}`, { headers: H })).json()).status;
const idle = async (id) => { await sleep(300); for (let i = 0; i < 600; i++, await sleep(100)) if (["idle", "waiting"].includes(await status(id).catch(() => ""))) return; };
let id = (await sat("channel.list", { guild_id: "1" })).data?.find((c) => c.name === "hello")?.id;
if (!id) { const cwd = `/tmp/cddf-perf/w${Date.now()}`; mkdirSync(cwd, { recursive: true }); id = (await sat("channel.create", { _data: { agent: "claude", cwd, text: "hello" } })).id; await idle(id); for (let i = 0; i < 3; i++) { await sat("message.create", { channel_id: id, content: `t${i} FASTSTREAM` }); await idle(id); } }
const browser = await puppeteer.launch({ executablePath: "/home/iridium/.cache/iridium-sample/browsers/chrome-headless-shell/linux-157.0.8103.38/chrome-headless-shell-linux64/chrome-headless-shell", headless: "shell", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
await page.goto(`${BASE}/#/s/${id}`, { waitUntil: "networkidle2" });
await sleep(1200);
await page.evaluate(() => {
  const el = document.querySelector("[role=log]"); window.__f = [];
  const tick = () => {
    const t0 = el.getBoundingClientRect().top;
    const mine = [...el.querySelectorAll("[data-seq], [data-bubble], .self-end")].at(-1);
    const sp = el.lastElementChild;
    const rows = el.querySelectorAll("[data-seq]");
    const last = rows[rows.length - 1];
    window.__f.push({ t: Math.round(performance.now()), top: Math.round(el.scrollTop), max: Math.round(el.scrollHeight - el.clientHeight), room: Math.round(sp.getBoundingClientRect().height), end: last ? Math.round(last.getBoundingClientRect().bottom - t0) : 0, h: el.clientHeight, text: last?.textContent.length ?? 0 });
    window.__r = requestAnimationFrame(tick);
  }; tick();
});
await page.click("[contenteditable], textarea");
await page.keyboard.type(what);
await page.keyboard.press("Enter");
await idle(id); await sleep(1000);
const f = await page.evaluate(() => (cancelAnimationFrame(window.__r), window.__f));
// Summaries: the scroll's moves, the room, where the reply's end was against the pane.
const moves = f.filter((x, i) => i && x.top !== f[i - 1].top);
console.log(`frames ${f.length}, scroll moved in ${moves.length}; first move at ${moves[0] ? moves[0].t - f[0].t : "-"}ms, last at ${moves.at(-1) ? moves.at(-1).t - f[0].t : "-"}ms`);
const every = Math.max(1, Math.floor(f.length / 40));
console.log(f.filter((_, i) => i % every === 0).map((x) => `${x.t - f[0].t}:${x.top}/${x.room}/${x.end}/${x.text}`).join(" "));
await browser.close();
