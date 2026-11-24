import { readFileSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
const dir = process.argv[2];
const env = Object.fromEntries(readFileSync(`${dir}/env`, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).replace(/^export /, ""), l.slice(l.indexOf("=") + 1)]));
const BASE = env.IRIDIUM_TEST_BASE.replace(/\/$/, "");
const H = { "content-type": "application/json", "x-requested-with": "XMLHttpRequest", "satori-platform": "local", "satori-user-id": "local" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sat = async (m, b) => { const r = await fetch(`${BASE}/v1/${m}`, { method: "POST", headers: H, body: JSON.stringify(b) }); const t = await r.text(); return t ? JSON.parse(t) : {}; };
const list = await sat("channel.list", { guild_id: "1" });
const id = list.data.at(-1).id;
const browser = await puppeteer.launch({ executablePath: "/home/iridium/.cache/iridium-sample/browsers/chrome-headless-shell/linux-157.0.8103.38/chrome-headless-shell-linux64/chrome-headless-shell", headless: "shell", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
await page.goto(`${BASE}/#/s/${id}`, { waitUntil: "networkidle2" });
await sleep(1200);
await page.evaluate(() => { const el = document.querySelector("[role=log]"); window.__s = []; const f = () => { window.__s.push([performance.now(), el.scrollTop, el.scrollHeight - el.clientHeight, window.__wheel ?? 0]); window.__r = requestAnimationFrame(f); }; f(); });
await sat("message.create", { channel_id: id, content: "go STREAM" });
await sleep(2500);
await page.mouse.move(600, 400);
await page.evaluate(() => (window.__wheel = 1));
for (let i = 0; i < 60; i++) { await page.mouse.wheel({ deltaY: 20 }); await sleep(16); }
await page.evaluate(() => (window.__wheel = 2));
await sleep(2500);
const s = await page.evaluate(() => (cancelAnimationFrame(window.__r), window.__s));
const phase = (w) => s.filter((x) => x[3] === w);
for (const w of [0, 1, 2]) { const p = phase(w); const moved = p.filter((x, i) => i && x[1] !== p[i - 1][1]).length; const left = p.map((x) => x[2] - x[1]); console.log(["before", "wheeling", "after"][w], "frames", p.length, "scroll moved in", moved, "left max", Math.max(...left).toFixed(0), "left at end", left.at(-1)?.toFixed(0)); }
await browser.close();
