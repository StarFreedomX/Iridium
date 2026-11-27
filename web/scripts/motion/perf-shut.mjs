// The bottom "put away" key pressed: where the message's head is, each frame.
import { readFileSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";
const dir = process.argv[2], q = process.argv[3] ?? "", follow = process.argv.includes("--follow");
const env = Object.fromEntries(readFileSync(`${dir}/env`, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).replace(/^export /, ""), l.slice(l.indexOf("=") + 1)]));
const BASE = env.IRIDIUM_TEST_BASE.replace(/\/$/, "");
const H = { "content-type": "application/json", "x-requested-with": "XMLHttpRequest", "satori-platform": "local", "satori-user-id": "local" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sat = async (m, b) => { const r = await fetch(`${BASE}/v1/${m}`, { method: "POST", headers: H, body: JSON.stringify(b) }); const t = await r.text(); return t ? JSON.parse(t) : {}; };
const status = async (id) => (await (await fetch(`${BASE}/v1/internal/sessions/${id}`, { headers: H })).json()).status;
const idle = async (id) => { await sleep(300); for (let i = 0; i < 600; i++, await sleep(100)) if (["idle", "waiting"].includes(await status(id).catch(() => ""))) return; };
let id = (await sat("channel.list", { guild_id: "1" })).data?.find((c) => c.name === "hello")?.id;
if (!id) { const cwd = `/tmp/cddf-perf/w${Date.now()}`; mkdirSync(cwd, { recursive: true }); id = (await sat("channel.create", { _data: { agent: "claude", cwd, text: "hello" } })).id; await idle(id); for (let i = 0; i < 4; i++) { await sat("message.create", { channel_id: id, content: `t${i} FASTSTREAM` }); await idle(id); } }
const browser = await puppeteer.launch({ executablePath: "/home/iridium/.cache/iridium-sample/browsers/chrome-headless-shell/linux-157.0.8103.38/chrome-headless-shell-linux64/chrome-headless-shell", headless: "shell", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
await page.goto(`${BASE}/${q}#/s/${id}`, { waitUntil: "networkidle2" });
await sleep(1200);
if (!follow) { await page.mouse.move(600, 400); await page.mouse.wheel({ deltaY: -300 }); await sleep(300); }
// The second last work line, its line near the pane's middle.
await page.evaluate((follow) => {
  const el = document.querySelector("[role=log]");
  const bs = [...el.querySelectorAll("[data-seq] button[aria-expanded]")].filter((b) => b.querySelector(".lucide-chevron-right"));
  const b = bs.at(follow ? -1 : -2); window.__key = b; window.__head = b.closest("[data-row]") ?? b.closest("[data-seq]");
  if (!follow) el.scrollTop += b.getBoundingClientRect().top - el.getBoundingClientRect().top - 300;
  const sort = b.parentElement.querySelector("button[aria-pressed]");
  (window.__sort = !!sort) ? sort.click() : b.click();
}, follow);
await sleep(800);
await page.evaluate(() => {
  const el = document.querySelector("[role=log]"); window.__f = [];
  const tick = () => { window.__f.push([Math.round(window.__head.getBoundingClientRect().top), Math.round(el.scrollTop), Math.round(el.scrollHeight)]); window.__r = requestAnimationFrame(tick); }; tick();
  const shut = [...window.__key.closest("[data-seq]").querySelectorAll("button")].find((b) => /Show less|收起/.test(b.textContent));
  setTimeout(() => shut.click(), 50);
});
await sleep(700);
const f = await page.evaluate(() => (cancelAnimationFrame(window.__r), window.__f));
console.log(q || "anchor", follow ? "follow" : "up", "head top / scrollTop / height per frame:\n" + f.map((x) => x.join("/")).join(" "));
await browser.close();
