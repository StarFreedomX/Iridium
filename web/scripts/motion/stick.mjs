// stick.mjs: the conversation's scroll (chat/stick.tsx, docs/动画.md), measured frame by frame
// against a test daemon with the fake claude (scripts/test-deploy.sh up <dir>), never a real one:
//
//   node web/scripts/motion/stick.mjs <dir of test-deploy.sh> [scene ...] [--noanchor] [--firefox] [--json out.json]
//
// Scenes: A stream followed, B stream scrolled up, C send, D work line pressed (following and
// scrolled up), K content over the pane changed while up, E older pages put in, F a burst of
// messages, R reduced motion, O a chat opened again. --noanchor opens the page with
// ?noanchor=1: the browser's scroll anchoring off, the module's own way of keeping what is seen.
// Two chats: a short one made anew each run (A–D, K, F, R, O) and a long one (E) made once and
// kept in <dir>/stick-ids.json.
// Each frame (after it is drawn) the page records the scroll, the column's height, the last
// message row's box and an anchor row's top (a row near the middle of the pane as the scene began).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const flag = (f) => (args.includes(f) ? (args.splice(args.indexOf(f), 1), true) : false);
const opt = (f) => (args.includes(f) ? args.splice(args.indexOf(f), 2)[1] : "");
const noanchor = flag("--noanchor");
const firefox = flag("--firefox");
const jsonOut = opt("--json");
const dir = args.shift();
if (!dir) throw new Error("usage: stick.mjs <deploy dir> [A B C D E F] [--noanchor] [--json out]");
const only = new Set(args);
const CHROME = process.env.CHROME ?? "/home/iridium/.cache/iridium-sample/browsers/chrome-headless-shell/linux-157.0.8103.38/chrome-headless-shell-linux64/chrome-headless-shell";
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
const status = async (id) => (await (await fetch(`${BASE}/v1/internal/sessions/${id}`, { headers: H })).json()).status;
async function idle(id, ms = 60000) {
  await sleep(300);
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (["idle", "waiting"].includes(await status(id).catch(() => ""))) return;
  throw new Error(`${id} not idle`);
}
const say = (id, text) => sat("message.create", { channel_id: id, content: text });

// --- the chats, made once ---
async function chat(name, turns) {
  const cwd = `/tmp/irui-stick-work/${name}`;
  mkdirSync(cwd, { recursive: true });
  const ch = await sat("channel.create", { _data: { agent: "claude", cwd, text: "hello" } });
  await idle(ch.id);
  for (let i = 0; i < turns; i++) {
    await say(ch.id, `${name} ${i}: walk me through it FASTSTREAM`);
    await idle(ch.id);
  }
  return ch.id;
}
const idsAt = `${dir}/stick-ids.json`;
const ids = existsSync(idsAt) ? JSON.parse(readFileSync(idsAt, "utf8")) : {};
// The short one anew each run: the page's own work per message grows with the chat, and the frames
// with it.
ids.S = await chat("short", 5);
writeFileSync(idsAt, JSON.stringify(ids));
if ((!only.size || only.has("E") || only.has("O")) && !ids.L) ids.L = await chat("long", 60);
writeFileSync(idsAt, JSON.stringify(ids));

// --- in the page: the probe ---
function probe() {
  const w = window;
  w.__p = { on: false, F: [], anchor: null, watch: null, n: 0 };
  const log = () => document.querySelector("main [role=log]") ?? document.querySelector("[role=log]");
  const ch = new MessageChannel();
  // After the frame is drawn: what was painted.
  ch.port1.onmessage = () => {
    const P = w.__p;
    const e = log();
    if (!P.on || !e) return;
    const er = e.getBoundingClientRect();
    const rows = e.querySelectorAll("[data-seq]");
    const last = rows[rows.length - 1];
    const lb = last?.getBoundingClientRect();
    P.F.push({
      t: performance.now(),
      st: e.scrollTop,
      sh: e.scrollHeight,
      ch: e.clientHeight,
      pb: parseFloat(e.style.paddingBottom) || 0,
      last: lb ? lb.bottom - (er.top + e.clientHeight - (parseFloat(e.style.paddingBottom) || 0)) : null,
      lastN: last?.dataset.seq,
      lg: (e.__n ??= ++P.n),
      a: P.anchor?.isConnected ? P.anchor.getBoundingClientRect().top - er.top : null,
      w: P.watch?.isConnected ? P.watch.getBoundingClientRect().top - er.top : null,
    });
  };
  const tick = () => (w.__p.on && ch.port2.postMessage(0), requestAnimationFrame(tick));
  requestAnimationFrame(tick);
  // The anchor: the message row nearest the middle of what is seen.
  w.__start = (watch) => {
    const e = log();
    const er = e.getBoundingClientRect();
    const mid = er.top + (e.clientHeight - (parseFloat(e.style.paddingBottom) || 0)) / 2;
    let best = null;
    let d = Infinity;
    for (const r of e.querySelectorAll("[data-seq]")) {
      const b = r.getBoundingClientRect();
      if (b.height && Math.abs(b.top - mid) < d) (d = Math.abs(b.top - mid)), (best = r);
    }
    w.__p.anchor = best;
    w.__p.watch = watch ? (window.__watch ?? null) : null;
    w.__p.F = [];
    w.__p.on = true;
    w.__m0 = (w.__moves ?? []).length;
  };
  w.__stop = () => ((w.__p.on = false), { F: w.__p.F, moves: (w.__moves ?? []).slice(w.__m0) });
}

// --- what the frames say ---
const TAU = 220; // motion.css --move
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
function judge({ F, moves }) {
  const out = { frames: F.length };
  if (process.env.TRACE) out.trace = F.map((f) => [Math.round(f.t), r1(f.st), f.sh, r1(f.a), r1(f.w), r1(f.last), f.lastN, f.pb]);
  if (process.env.TRACE) out.log = moves;
  // The anchor row's top, frame to frame: up (negative) or down; reversals of direction.
  let up = 0, down = 0, turns = 0, dir = 0, maxDown = 0, maxUp = 0, path = 0;
  for (let i = 1; i < F.length; i++) {
    if (F[i].a == null || F[i - 1].a == null) continue;
    const d = F[i].a - F[i - 1].a;
    if (Math.abs(d) <= 0.5) continue;
    path += Math.abs(d);
    if (d < 0) (up++, (maxUp = Math.max(maxUp, -d)));
    else (down++, (maxDown = Math.max(maxDown, d)));
    const s = Math.sign(d);
    if (dir && s !== dir) turns++;
    dir = s;
  }
  Object.assign(out, { anchorUp: up, anchorDown: down, reversals: turns, maxUpStep: r1(maxUp), maxDownStep: r1(maxDown), anchorPath: r1(path), anchorNet: r1((F.at(-1)?.a ?? 0) - (F[0]?.a ?? 0)) });
  // How far from the end, each frame (px of scroll left), and that less what came this frame.
  let maxLeft = 0, maxLag = 0;
  for (let i = 1; i < F.length; i++) {
    const left = F[i].sh - F[i].ch - F[i].st;
    const came = Math.max(0, F[i].sh - F[i - 1].sh);
    maxLeft = Math.max(maxLeft, left);
    maxLag = Math.max(maxLag, left - came);
  }
  // The follow's own bound: each px that came, eased out at TAU (stick.tsx approach, what comes
  // by itself; a person's doing is three times as quick), at most 32ms of it a frame as there:
  // how far past it the frames ever were.
  let bound = F.length ? F[0].sh - F[0].ch - F[0].st : 0, over = 0;
  for (let i = 1; i < F.length; i++) {
    bound = bound * Math.exp(-Math.min(32, F[i].t - F[i - 1].t) / TAU) + Math.max(0, F[i].sh - F[i - 1].sh);
    over = Math.max(over, F[i].sh - F[i].ch - F[i].st - bound);
  }
  out.overBound = r1(over);
  // Settled: from the frame the scroll last reached the end after the last growth, the most it
  // was ever off again.
  let lastGrow = 0;
  for (let i = 1; i < F.length; i++) if (F[i].sh !== F[i - 1].sh || F[i].pb !== F[i - 1].pb) lastGrow = i;
  const at = F.findIndex((f, i) => i >= lastGrow && f.sh - f.ch - f.st <= 0.5);
  const after = at < 0 ? [] : F.slice(at);
  const f = F.at(-1);
  Object.assign(out, {
    maxLeft: r1(maxLeft),
    maxLag: r1(maxLag),
    finalLeft: f ? r1(f.sh - f.ch - f.st) : null,
    offAfterSettle: after.length ? r1(Math.max(...after.map((x) => x.sh - x.ch - x.st))) : null,
    lastRowEnd: f ? r1(f.last) : null,
    scrollMoves: F.slice(1).filter((x, i) => Math.abs(x.st - F[i].st) > 0.5).length,
    grew: f ? f.sh - F[0].sh : 0,
  });
  // The pressed line's own top (D): how far it ever was from where it began.
  const ws = F.filter((x) => x.w != null).map((x) => x.w);
  if (ws.length) out.pressedMoved = r1(Math.max(...ws.map((x) => Math.abs(x - ws[0]))));
  const by = {};
  for (const m of moves) by[`${m.who} ${m.why}`] = (by[`${m.who} ${m.why}`] ?? 0) + 1;
  out.moves = by;
  return out;
}

// --- the run ---
const browser = firefox
  ? await puppeteer.launch({ browser: "firefox", executablePath: process.env.FIREFOX ?? "/usr/bin/firefox", headless: true, args: ["--width=1100", "--height=900"] })
  : await puppeteer.launch({ executablePath: CHROME, headless: "shell", args: ["--mute-audio", "--no-sandbox", "--window-size=1100,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.evaluateOnNewDocument(probe);
const q = noanchor ? "?lang=en&noanchor=1" : "?lang=en";
const open = async (id) => {
  await page.goto(`${BASE}/${q}#/s/${id}`, { waitUntil: "networkidle2" });
  await page.waitForSelector("[role=log] [data-seq]");
  await sleep(1500);
};
const start = (watch = false) => page.evaluate((w) => window.__start(w), watch);
const stop = () => page.evaluate(() => window.__stop());
const pane = () => page.evaluate(() => { const e = document.querySelector("main [role=log]") ?? document.querySelector("[role=log]"); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 300, left: e.scrollHeight - e.clientHeight - e.scrollTop, top: e.scrollTop }; });
const wheel = async (dy) => {
  const p = await pane();
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel({ deltaY: dy });
  await sleep(700);
};
const toBottom = async () => {
  const k = await page.$("main [role=log] ~ button, [role=log] + button");
  if (k) await k.click();
  else await wheel(100000);
  await sleep(1200);
};
const out = {};
const scene = async (name, f) => {
  if (only.size && !only.has(name[0])) return;
  try {
    out[name] = await f();
  } catch (e) {
    out[name] = { error: String(e.message).split("\n")[0] };
  }
  const { trace, log, ...shown } = out[name];
  console.log(name, JSON.stringify(shown));
};
const S = ids.S;

await open(S);
await scene("A stream, following", async () => {
  await start();
  await say(S, "follow this STREAM");
  await idle(S);
  await sleep(1500);
  return judge(await stop());
});
await scene("B stream, scrolled up 600px", async () => {
  await wheel(-600);
  const p0 = await pane();
  await start();
  await say(S, "while up STREAM");
  await idle(S);
  await sleep(1500);
  const r = judge(await stop());
  const p1 = await pane();
  r.scrollTop = [Math.round(p0.top), Math.round(p1.top)];
  r.newKey = await page.evaluate(() => [...document.querySelectorAll("main button")].some((b) => /new|新消息/i.test(b.innerText)));
  return r;
});
await scene("B then the key to go down pressed, and a message after", async () => {
  await start();
  const k = await page.$("[role=log] ~ button");
  if (!k) return { error: "no key" };
  await k.click();
  await sleep(1200);
  const left = (await pane()).left;
  await say(S, "after the key");
  await idle(S);
  await sleep(1500);
  return { ...judge(await stop()), leftAfterKey: r1(left) };
});
if (!only.size || only.has("C") || only.has("D") || only.has("F")) await toBottom();
await scene("C send from the composer", async () => {
  await page.click("main textarea");
  await start();
  await page.keyboard.type("a word of mine");
  await page.keyboard.press("Enter");
  await sleep(3000);
  return judge(await stop());
});
// A work line in view: a turn that works without saying a word first (AROUND: two calls), its
// message the work line alone, at the end.
const workButton = (lo, hi) =>
  page.evaluate((lo, hi) => {
    const e = document.querySelector("main [role=log]") ?? document.querySelector("[role=log]");
    const er = e.getBoundingClientRect();
    const bs = [...e.querySelectorAll("[data-seq] button[aria-expanded]")].filter((b) => {
      // A work line says its steps (a face, pressed, opens a card).
      if (!/\d/.test(b.innerText)) return false;
      const r = b.getBoundingClientRect();
      return r.top - er.top > lo && r.bottom - er.top < hi && r.width > 0;
    });
    const b = bs.at(-1);
    if (!b) return null;
    window.__watch = b;
    const r = b.getBoundingClientRect();
    return { x: r.left + 30, y: r.top + r.height / 2 };
  }, lo, hi);
// The same line pressed again, where it is now.
const pressedAt = () => page.evaluate(() => { const r = window.__watch.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2, open: window.__watch.getAttribute("aria-expanded") }; });
await scene("D work line, following: open", async () => {
  await say(S, "work at once AROUND");
  await idle(S);
  await sleep(1500);
  const b = await workButton(60, 760);
  if (!b) return { error: "no work line in view" };
  await start(true);
  await page.mouse.click(b.x, b.y);
  await sleep(1500);
  const r = judge(await stop());
  r.expanded = (await pressedAt()).open;
  out._dAt = b;
  return r;
});
await scene("D work line, following: close", async () => {
  if (!out._dAt) return { error: "no work line in view" };
  const b = await pressedAt();
  await start(true);
  await page.mouse.click(b.x, b.y);
  await sleep(1500);
  return { ...judge(await stop()), expanded: (await pressedAt()).open };
});
const upTo = async () => {
  // Up till a work line is in the middle of what is seen (at least 300px up).
  await wheel(-300);
  for (let i = 0; i < 20; i++) {
    const b = await workButton(150, 500);
    if (b) return b;
    await wheel(-250);
  }
  return null;
};
await scene("D work line, scrolled up: open", async () => {
  const b = await upTo();
  if (!b) return { error: "no work line in view" };
  await start(true);
  await page.mouse.click(b.x, b.y);
  await sleep(1500);
  const r = judge(await stop());
  r.expanded = (await pressedAt()).open;
  out._dUp = b;
  return r;
});
await scene("D work line, scrolled up: close", async () => {
  const b = out._dUp;
  if (!b) return { error: "no work line in view" };
  const now = await pressedAt();
  await start(true);
  await page.mouse.click(now.x, now.y);
  await sleep(1500);
  return { ...judge(await stop()), expanded: (await pressedAt()).open };
});
// Content over what is seen changes as the reader is up: a work line above the pane opened and
// shut (pressed by the page's own hand, out of view). Rows seen move 0px.
const above = (press) =>
  page.evaluate((press) => {
    const e = document.querySelector("main [role=log]") ?? document.querySelector("[role=log]");
    const top = e.getBoundingClientRect().top;
    // The same one both times.
    const b = window.__above ?? [...e.querySelectorAll("[data-seq] button[aria-expanded]")].filter((x) => /\d/.test(x.innerText) && x.getBoundingClientRect().bottom < top - 20).at(-1);
    if (b && press) (b.click(), (window.__above = b));
    return b ? b.getAttribute("aria-expanded") : null;
  }, press);
await scene("K content above the pane, scrolled up: opened, then shut", async () => {
  await wheel(-400);
  if (!(await above(false))) return { error: "no work line above the pane" };
  await start();
  await above(true);
  await sleep(1200);
  const open = judge(await stop());
  await start();
  const was = await above(true);
  await sleep(1200);
  const shut = { ...judge(await stop()), was };
  const pick = (r) => ({ frames: r.frames, grew: r.grew, anchorPath: r.anchorPath, maxStep: Math.max(r.maxUpStep, r.maxDownStep), moves: r.moves });
  return { open: pick(open), shut: pick(shut) };
});
delete out._dAt;
delete out._dUp;
if (!only.size || only.has("F")) await toBottom();
await scene("F burst: 8 messages 100ms apart", async () => {
  await start();
  for (let i = 0; i < 8; i++) {
    void say(S, `burst ${i}`);
    await sleep(100);
  }
  await idle(S);
  await sleep(2000);
  return judge(await stop());
});
// The watched row's top on the frames the older page came in on.
function prepends({ F }) {
  const at = [];
  for (let i = 1; i < F.length; i++) if (F[i].sh > F[i - 1].sh + 50) at.push({ grew: Math.round(F[i].sh - F[i - 1].sh), moved: r1(F[i].a - F[i - 1].a), scrolled: r1(F[i].st - F[i - 1].st) });
  let max = 0;
  for (let i = 1; i < F.length; i++) if (F[i].a != null && F[i - 1].a != null) max = Math.max(max, Math.abs(F[i].a - F[i - 1].a));
  return { frames: F.length, pages: at, maxRowMove: r1(max) };
}
await scene("R reduced motion: a stream followed", async () => {
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await toBottom();
  await start();
  await say(S, "reduced STREAM");
  await idle(S);
  await sleep(1500);
  const { F, moves } = await stop();
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  // Each frame off the end only as the one it came in: the next is at the end.
  let after = 0;
  for (let i = 1; i < F.length; i++) if (F[i].sh - F[i].ch - F[i].st > 0.5 && F[i - 1].sh - F[i - 1].ch - F[i - 1].st > 0.5) after++;
  return { ...judge({ F, moves }), framesOffTwice: after };
});
const hash = (id) => page.evaluate((id) => (location.hash = `#/s/${id}`), id);
await scene("O opened again: at the newest in its first frame", async () => {
  await toBottom();
  await hash(ids.L);
  await sleep(1500);
  await start();
  await hash(S);
  await sleep(2000);
  const { F, moves } = await stop();
  const i = F.findIndex((f, j) => j > 0 && f.lg !== F[0].lg);
  const left = F.slice(i).map((f) => f.sh - f.ch - f.st);
  return { frames: F.length - i, firstLeft: r1(left[0]), maxLeft: r1(Math.max(...left)), scrollMoves: F.slice(i + 1).filter((x, j) => Math.abs(x.st - F[i + j].st) > 0.5).length, moves: moves.map((m) => `${m.who} ${m.why} ${m.dy ?? ""}`) };
});
await scene("O opened again: the place it was left at", async () => {
  await wheel(-900);
  const was = (await pane()).top;
  await hash(ids.L);
  await sleep(1500);
  await start();
  await hash(S);
  await sleep(1500);
  const { F } = await stop();
  const i = F.findIndex((f, j) => j > 0 && f.lg !== F[0].lg);
  return { was: Math.round(was), first: Math.round(F[i]?.st), after: Math.round(F.at(-1).st), scrollMoves: F.slice(i + 1).filter((x, j) => Math.abs(x.st - F[i + j].st) > 0.5).length };
});
if (!only.size || only.has("E")) {
  await open(ids.L);
  await scene("E older pages put in", async () => {
    await wheel(-400);
    const res = [];
    for (let k = 0; k < 6; k++) {
      // Near the top by the page's own hand, then nothing else: the page before comes in.
      // Recording from the same task: the page before comes after it, at the earliest.
      await page.evaluate(() => { const e = document.querySelector("main [role=log]") ?? document.querySelector("[role=log]"); e.scrollTop = 200; window.__start(false); });
      await sleep(1500);
      const r = prepends(await stop());
      res.push(r);
      if (!r.pages.length) break;
    }
    const pages = res.flatMap((r) => r.pages);
    return { pages: pages.length, frames: res.reduce((n, r) => n + r.frames, 0), maxRowMove: Math.max(...res.map((r) => r.maxRowMove)), each: pages };
  });
}
if (errors.length) console.log("page errors:", errors.slice(0, 5));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
await browser.close();
