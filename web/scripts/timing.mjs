// The conversation's timing, measured frame by frame (docs/前端设计规范.md "动画协调"): what the
// user sees as a chat is switched to, a message is sent (one line, several, a picture), an answer
// streams and its turn ends. Against a test daemon with the fake claude (scripts/test-deploy.sh up),
// never a real one:
//   CHROME=<chrome-headless-shell> node scripts/timing.mjs [dir of test-deploy.sh] [--json out.json]
// Each frame the page records where the conversation's rows are drawn (their boxes as painted,
// transforms and all), the column's height and the scroll; each scenario then says what the eye
// saw: how long till anything moved, how long till all was still, whether what was already there
// went one way only (turns: it went up and came back), whether the end came down and up again
// (dips), and any jump (a move of more than JUMP px in one frame, not animated).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { crc32, deflateSync } from "node:zlib";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : "";
const dir = args[0] ?? `${process.env.TMPDIR ?? "/tmp"}/iridium-test-deploy`;
const env = Object.fromEntries(
  readFileSync(`${dir}/env`, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const BASE = env.IRIDIUM_TEST_BASE.replace(/\/$/, "");
const H = { "content-type": "application/json", "x-requested-with": "XMLHttpRequest", "satori-platform": "local", "satori-user-id": "local" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sat(method, body) {
  const r = await fetch(`${BASE}/v1/${method}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : {};
}
async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function until(what, f, ms = 20000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const v = await f().catch(() => undefined);
    if (v) return v;
  }
  throw new Error(`timed out: ${what}`);
}
const idle = async (id) => until(`${id} idle`, async () => ["idle", "waiting"].includes((await get(`/v1/internal/sessions/${id}`)).status));

/** A session of the fake claude in a folder of its own, with turns enough to scroll. */
async function session(name, turns) {
  const cwd = `${tmpdir()}/iridium-timing/${name}`;
  mkdirSync(cwd, { recursive: true });
  const ch = await sat("channel.create", { _data: { agent: "claude", cwd } });
  await idle(ch.id).catch(() => {});
  for (let i = 0; i < turns; i++) {
    await sat("message.create", { channel_id: ch.id, content: `${name} ${i}: ${"words to fill a line or two of the conversation ".repeat(1 + (i % 3))}` });
    await idle(ch.id);
  }
  return ch.id;
}


/** A PNG of w×h: a soft gradient, as a screenshot. */
function pngOf(w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) (row[1 + x * 3] = 150 + Math.round((x / w) * 60)), (row[2 + x * 3] = 180 + Math.round((y / h) * 40)), (row[3 + x * 3] = 220 - Math.round((x / w) * 40));
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

// --- in the page: the recorder ---
function recorder() {
  const w = window;
  const ids = new WeakMap();
  let next = 0;
  const idOf = (el) => (ids.has(el) ? ids.get(el) : (ids.set(el, ++next), next));
  w.__t = { frames: [], on: false, acts: [] };
  for (const k of ["pointerdown", "keydown"]) addEventListener(k, (e) => w.__t.on && w.__t.acts.push({ t: performance.now(), k: e.type, key: e.key }), true);
  const frame = () => {
    const T = w.__t;
    if (T.on) {
      const log = document.querySelector('[role="log"]');
      const col = log?.firstElementChild;
      const f = { t: performance.now(), turn: document.documentElement.dataset.turn ?? "", log: log ? idOf(log) : 0, scroll: log?.scrollTop ?? 0, colH: col?.offsetHeight ?? 0, rows: [], anims: document.getAnimations().filter((a) => a.playState === "running").length, names: document.getAnimations().filter((a) => a.playState === "running").map((a) => `${a.animationName ?? a.transitionProperty ?? "js"}${a.effect?.pseudoElement ?? ""}<${a.effect?.target?.dataset?.flip ?? String(a.effect?.target?.className ?? "").slice(0, 24)}>${Math.round(a.effect?.getTiming().duration ?? 0)}`) };
      if (col) {
        const top = log.getBoundingClientRect().top;
        for (const el of col.children) {
          const r = el.getBoundingClientRect();
          if (r.bottom < top - 400 || r.height === 0) continue;
          f.rows.push({ id: idOf(el), k: el.dataset.flip ?? "", y: +(r.top - top).toFixed(1), h: +r.height.toFixed(1), o: +getComputedStyle(el).opacity });
        }
      }
      T.frames.push(f);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

const JUMP = 24; // px in one frame, not animated, that is a jump
/** What the eye saw from t0 on (frames of one recording). */
function judge(frames, t0) {
  const fs = frames.filter((f) => f.t >= t0 - 1);
  if (!fs.length) return { error: "no frames" };
  const first = fs[0];
  // What was there before: rows by their element, drawn throughout.
  const before = new Set(first.rows.map((r) => r.id));
  let firstMove = null;
  let lastMove = null;
  let turns = 0;
  let jumps = 0;
  let dir = 0;
  const path = new Map();
  for (let i = 1; i < fs.length; i++) {
    const a = fs[i - 1];
    const b = fs[i];
    const changed = a.log !== b.log || a.turn !== b.turn || a.rows.length !== b.rows.length || a.rows.some((r, j) => b.rows[j]?.id !== r.id || Math.abs(b.rows[j].y - r.y) > 0.5 || Math.abs(b.rows[j].h - r.h) > 0.5 || Math.abs(b.rows[j].o - r.o) > 0.02);
    if (changed) {
      firstMove ??= b.t - t0;
      lastMove = b.t - t0;
    }
    // The rows that were there before, as one: how far they moved this frame (the median).
    const at = new Map(a.rows.map((r) => [r.id, r]));
    const ds = b.rows.filter((r) => before.has(r.id) && at.has(r.id)).map((r) => r.y - at.get(r.id).y);
    if (!ds.length || a.log !== b.log) continue;
    ds.sort((x, y) => x - y);
    const d = ds[ds.length >> 1];
    if (Math.abs(d) < 0.5) continue;
    const s = Math.sign(d);
    if (dir && s !== dir) turns++;
    dir = s;
    path.set("sum", (path.get("sum") ?? 0) + Math.abs(d));
    if (Math.abs(d) > JUMP && b.anims === 0) jumps++;
  }
  // The end of the conversation (the last row's bottom as drawn): down and back up, or up and back.
  let dips = 0;
  let low = Infinity;
  const ends = fs.map((f) => (f.rows.length ? f.rows.at(-1).y + f.rows.at(-1).h : 0));
  const hs = fs.map((f) => f.colH);
  for (let i = 1; i < hs.length; i++) {
    if (hs[i] < hs[i - 1] - 2) low = Math.min(low, hs[i]);
    else if (low !== Infinity && hs[i] > low + 2) (dips++, (low = Infinity));
  }
  return { firstMove: round(firstMove), still: round(lastMove), turns, jumps, dips, path: round(path.get("sum") ?? 0), endFrom: round(ends[0]), endTo: round(ends.at(-1)) };
}
const round = (v) => (v == null ? null : Math.round(v));

// --- the run ---
const A = await session("alpha", 8);
const B = await session("beta", 8);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: "shell", args: ["--mute-audio", "--window-size=1440,900", ...(process.env.NO_SANDBOX ? ["--no-sandbox"] : [])] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.evaluateOnNewDocument(recorder);
// LATENCY=<ms>: each request that long on the way, as over a tunnel (Cloudflare) and not here.
if (process.env.LATENCY) {
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: +process.env.LATENCY, downloadThroughput: -1, uploadThroughput: -1 });
}
await page.goto(`${BASE}/?lang=en#/s/${A}`, { waitUntil: "networkidle2" });
await page.waitForSelector('[role="log"] textarea, textarea');
await sleep(1500);

const out = {};
async function measure(name, act, settle = 1500) {
  await page.evaluate(() => ((window.__t.frames = []), (window.__t.acts = []), (window.__t.on = true)));
  await sleep(100);
  const t0 = await page.evaluate(() => performance.now());
  await act();
  await sleep(settle);
  const { frames, acts } = await page.evaluate(() => ((window.__t.on = false), { frames: window.__t.frames, acts: window.__t.acts }));
  // From the user's own press or key when there was one.
  const from = acts.length ? acts[0].t : t0;
  out[name] = { ...judge(frames, from), frames: frames.length };
  if (jsonOut) out[name].trace = frames;
}
const go = (id) => page.evaluate((id) => (location.hash = `#/s/${id}`), id);
const composer = async () => {
  await page.click("textarea");
};

// Switch: to one drawn before (both are now), and back.
await go(B);
await sleep(1500);
await measure("switch (seen before)", () => go(A), 1200);
await measure("switch back", () => go(B), 1200);
await go(A);
await sleep(1500);

// Send: one line, then several, then a picture; the fake claude answers at once (秒回).
await composer();
await measure("send one line", async () => {
  await page.keyboard.type("one line of words");
  await page.evaluate(() => ((window.__t.frames = []), (window.__t.acts = [])));
  await page.keyboard.press("Enter");
}, 2500);
await idle(A);
await composer();
await measure("send four lines", async () => {
  for (const l of ["first line", "second line", "third line", "fourth line"]) {
    await page.keyboard.type(l);
    await page.keyboard.down("Shift");
    await page.keyboard.press("Enter");
    await page.keyboard.up("Shift");
  }
  await page.keyboard.type("fifth");
  await page.evaluate(() => ((window.__t.frames = []), (window.__t.acts = [])));
  await page.keyboard.press("Enter");
}, 2500);
await idle(A);
// A picture: a PNG put in the composer's file input.
const png = `${tmpdir()}/iridium-timing/pic.png`;
writeFileSync(png, pngOf(900, 600));
const input = await page.$('input[type="file"]');
if (input) {
  await input.uploadFile(png);
  await sleep(1500);
  await composer();
  await measure("send a picture", async () => {
    await page.keyboard.type("a picture");
    await page.evaluate(() => ((window.__t.frames = []), (window.__t.acts = [])));
    await page.keyboard.press("Enter");
  }, 3000);
  await idle(A);
}

// Sent, and answered as a real one is: the turn on with nothing yet, then words a piece at a time.
await composer();
await measure("send, slow answer", async () => {
  await page.keyboard.type("slowly STREAM");
  await page.evaluate(() => ((window.__t.frames = []), (window.__t.acts = [])));
  await page.keyboard.press("Enter");
}, 3000);
await idle(A);

// An answer streamed, and its turn ending (a code block in it).
await composer();
await page.keyboard.type("tell me FASTSTREAM");
await page.keyboard.press("Enter");
await until("the stream begins", () => page.evaluate(() => document.querySelector('[role="log"]')?.innerText.includes("glide") ?? false), 20000).catch(() => {});
const tEnd = Date.now();
await measure("turn ends", async () => {
  await idle(A);
}, 2000);
out["turn ends"].waited = Date.now() - tEnd;

await browser.close();
if (errors.length) out.errors = errors;
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out));
for (const [k, v] of Object.entries(out)) {
  if (k === "errors") continue;
  const { trace, ...rest } = v;
  console.log(k.padEnd(22), JSON.stringify(rest));
}
if (errors.length) console.log("page errors:", errors);
