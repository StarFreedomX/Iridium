// pop.mjs: popups opened, shut and pressed fast, measured frame by frame (docs/前端设计规范.md
// "弹窗、页面打开时就是完整的", docs/动画.md), against a test daemon with the fake claude
// (scripts/test-deploy.sh up <dir>), never a real one:
//
//   node web/scripts/motion/pop.mjs <dir of test-deploy.sh> [popup ...] [--p1] [--p2] [--json out.json]
//
// It makes a channel once (kept in <dir>/pop-ids.json): its claude's turn with two calls (a work
// line), a second claude, bob-<n>. Then, for each popup it can reach:
//   P1  its box (offsetWidth/Height: not the open transition's transform) from its first painted
//       frame to 1500ms after: by how much it ever changed. Three runs, each a fresh browser
//       profile: normal; throttled (400ms on every request) with the press 2s after its key is on
//       screen (idle prefetch had its chance); throttled with the press as its key appears
//       (pointer over it, pressed at once).
//   P3  during its opening and its shutting (Esc), its layout box and its place less the transform
//       do not change.
//   P2  pressed open, at 60ms shut, at 120ms open: frames from each press to its opacity going the
//       new way; and a second key pressed while the first shuts, and a press outside while it
//       opens. Ends as it should.
// The page is told to report a query a popup starts as it opens (api/query.ts, window.__popcheck):
// each scene's list of those is printed with it ("late").
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const flag = (f) => (args.includes(f) ? (args.splice(args.indexOf(f), 1), true) : false);
const opt = (f) => (args.includes(f) ? args.splice(args.indexOf(f), 2)[1] : "");
const onlyP1 = flag("--p1");
const onlyP2 = flag("--p2");
const jsonOut = opt("--json");
const dir = args.shift();
if (!dir) throw new Error("usage: pop.mjs <deploy dir> [popup ...] [--p1] [--p2] [--json out]");
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
async function call(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : {};
}
const status = async (id) => (await call("GET", `/v1/internal/sessions/${id}`)).status;
async function idle(id) {
  await sleep(300);
  for (let i = 0; i < 600; i++, await sleep(100)) if (["idle", "waiting"].includes(await status(id).catch(() => ""))) return;
  throw new Error(`${id} not idle`);
}

// --- the channel, made once ---
const idsAt = `${dir}/pop-ids.json`;
let ids = existsSync(idsAt) ? JSON.parse(readFileSync(idsAt, "utf8")) : null;
if (!ids) {
  const cwd = "/tmp/irui-pop-work/a";
  mkdirSync(cwd, { recursive: true });
  const ch = await call("POST", "/v1/channel.create", { _data: { agent: "claude", cwd, text: "hello" } });
  await idle(ch.id);
  await call("POST", "/v1/message.create", { channel_id: ch.id, content: "look at the list FASTSTREAM" });
  await idle(ch.id);
  await call("POST", `/v1/internal/channels/${ch.id}/members`, { agent: "claude", nick: `bob-${Date.now().toString(36).slice(-4)}`, text: "hi" });
  await sleep(3000);
  // One with its agent alone: its commands (the / list).
  mkdirSync("/tmp/irui-pop-work/b", { recursive: true });
  const solo = await call("POST", "/v1/channel.create", { _data: { agent: "claude", cwd: "/tmp/irui-pop-work/b", text: "hello" } });
  await idle(solo.id);
  ids = { chat: ch.id, solo: solo.id };
  writeFileSync(idsAt, JSON.stringify(ids));
}

// --- in the page: presses and frames ---
function probe() {
  window.__popcheck = true;
  const SURF = ".g-unfold:is([role=menu],[role=dialog],[role=listbox],[role=alertdialog]), .g-dialog, .g-sheet";
  const P = (window.__pop = { presses: [], F: [], on: false, before: new Set(), el: null, mode: "new", text: "" });
  addEventListener("pointerdown", () => P.presses.push(performance.now()), { capture: true });
  addEventListener("keydown", () => P.presses.push(performance.now()), { capture: true });
  const all = () => [...document.querySelectorAll(SURF)];
  P.mark = (mode = "new", text = "") => {
    P.before = new Set(all());
    P.mode = mode;
    P.text = text;
    P.el = mode === "same" ? all().filter((e) => !e.hasAttribute("data-ending-style")).at(-1) : mode === "sheet" ? document.querySelector(".g-sheet") : null;
    P.presses = [];
  };
  P.find = () => {
    if (P.el && P.mode !== "new") return P.el.isConnected ? P.el : null;
    const fresh = all().filter((e) => !P.before.has(e) && (!P.text || e.textContent.includes(P.text)));
    if (fresh.length) P.el = fresh.at(-1);
    return P.el?.isConnected ? P.el : null;
  };
  const sample = (t) => {
    const e = P.find();
    if (!e) return P.F.push({ t, on: false });
    const cs = getComputedStyle(e);
    const m = cs.transform && cs.transform !== "none" ? new DOMMatrixReadOnly(cs.transform) : null;
    const par = e.offsetParent?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    P.F.push({
      t,
      on: true,
      w: e.offsetWidth,
      h: e.offsetHeight,
      // Its place less the transform: its offset in its positioned parent, that parent's place.
      x: par.left + e.offsetLeft,
      y: par.top + e.offsetTop,
      op: +cs.opacity,
      sc: m ? m.a : 1,
      ty: m ? m.f : 0,
      ending: e.hasAttribute("data-ending-style"),
    });
  };
  const ch = new MessageChannel();
  let at = 0;
  // After the frame is drawn: what was painted.
  ch.port1.onmessage = () => P.on && sample(at);
  const frame = (t) => {
    if (!P.on) return;
    at = t;
    ch.port2.postMessage(0);
    requestAnimationFrame(frame);
  };
  P.start = () => {
    P.F = [];
    P.on = true;
    requestAnimationFrame(frame);
  };
  P.stop = () => ((P.on = false), { F: P.F, presses: P.presses, late: [...(window.__late ?? [])] });
}

// --- the browser ---
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell", args: ["--mute-audio", "--no-sandbox", "--window-size=1200,900"] });
const results = [];
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** A fresh profile (no cache, no storage) and a page in it, throttled or not. */
async function fresh({ phone = false, slow = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(phone ? { width: 390, height: 844 } : { width: 1200, height: 900 });
  await page.evaluateOnNewDocument(probe);
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  if (slow) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: -1, uploadThroughput: -1 });
  page.on("pageerror", (e) => console.log("  pageerror", e.message.slice(0, 160)));
  return { ctx, page };
}
const load = (page, chat = "chat") => page.goto(`${BASE}/?lang=en#/s/${ids[chat]}`, { waitUntil: "domcontentloaded" });
/** The centre of what sel finds (the last; or the last with text in it or its label), brought into view. */
async function where(page, sel, text, timeout = 15000) {
  for (let i = 0; i < 6; i++) {
    const p = await find(page, sel, text, timeout);
    if (process.env.DEBUG) console.log("  where", sel, text, JSON.stringify(p));
    if (!p.wheel) return p;
    // Over the conversation near the window's top: not over a list of its own that scrolls (a
    // work line's steps; the log is the whole column, its box mostly off screen).
    const log = await page.$eval("main [role=log]", (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: 110 }; });
    await page.mouse.move(log.x, log.y);
    await page.mouse.wheel({ deltaY: p.wheel });
    await sleep(500);
  }
  return find(page, sel, text, timeout);
}
async function find(page, sel, text, timeout) {
  const h = await page.waitForFunction(
    (s, x) => {
      const els = [...document.querySelectorAll(s)].filter((e) => !e.closest("[data-ending-style]") && (!x || e.textContent.includes(x) || e.getAttribute("aria-label")?.includes(x)));
      // Drawn, or in the conversation off screen (content-visibility: no box till it is near).
      const e = els.filter((e) => e.getBoundingClientRect().width > 0).at(-1) ?? els.filter((e) => e.closest("[role=log]")).at(-1);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const out = r.top < 60 || r.bottom > innerHeight - 120;
      // In the conversation: by the wheel, as a person would (its follow lets go only for that).
      if (out && e.closest("[role=log]")) return { x: 0, y: 0, wheel: Math.round(r.top - innerHeight / 2) };
      if (out) e.scrollIntoView({ block: "center" });
      const q = e.getBoundingClientRect();
      return { x: q.left + q.width / 2, y: q.top + q.height / 2, moved: out };
    },
    { timeout, polling: "raf" },
    sel,
    text ?? "",
  );
  return h.jsonValue();
}
async function press(page, sel, { text, button = "left" } = {}) {
  let p = await where(page, sel, text);
  // Scrolled to: found again once the conversation is still.
  if (p.moved) (await sleep(400), (p = await where(page, sel, text)));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button });
  await page.mouse.up({ button });
  return p;
}
const esc = (page) => page.keyboard.press("Escape");
/** The keyboard's way to a key (focus, Enter): one in the conversation that a pointer would have
 *  to scroll to, under the conversation's follow (a work line's steps). */
const focusOn = (page, sel, text) =>
  page.waitForFunction(
    (s, x) => {
      const e = [...document.querySelectorAll(s)].filter((e) => e.textContent.includes(x)).at(-1);
      e?.focus();
      return !!e && document.activeElement === e;
    },
    { timeout: 30000 },
    sel,
    text,
  );
async function enter(page, sel, text) {
  await focusOn(page, sel, text);
  await page.keyboard.press("Enter");
}
const ready = (page) => find(page, "main [role=log] button", "", 60000);

// --- the popups ---
// pre: what is done first (open a parent); key: [selector, text] of what opens it; how: left,
// right (a context menu), type (keys into the composer); watch: "new" (a popup that comes),
// "same" (the one open: a page put in it); text: what the new popup has, among several.
const FACE = 'main [role=log] button[aria-label^="bob-"]';
const MEMBERS = 'button[aria-label="Members"]';
const MORE = 'button[aria-label="More"]';
const ITEM = "[role=menu] [role=menuitem]";
const SCENES = [
  { name: "card", key: [FACE] },
  { name: "card→edit", pre: async (p) => (await press(p, FACE), await sleep(400)), key: ["[role=dialog] button", "Edit profile"], watch: "same" },
  { name: "members", key: [MEMBERS] },
  { name: "members→invite", pre: async (p) => (await press(p, MEMBERS), await sleep(400)), key: [ITEM, "Invite"] },
  // Pointed at: a mouse's press of a kind invites one (invite.tsx Kind).
  { name: "invite→models", pre: async (p) => (await press(p, MEMBERS), await sleep(400), await press(p, ITEM, { text: "Invite" }), await sleep(400)), key: [ITEM, "Claude"], how: "hover" },
  { name: "face menu", key: [FACE], how: "right" },
  { name: "face menu→model", pre: async (p) => (await press(p, FACE, { button: "right" }), await sleep(400)), key: [ITEM, "Model"] },
  { name: "context ring", key: ['main [role=log] button[aria-label^="Context"]'] },
  { name: "quota", key: ['main [role=log] button[aria-label^="Quota"]'] },
  { name: "message menu", key: ["main [role=log] p", "That is all of it"], how: "right" },
  { name: "⋯ menu", key: [MORE] },
  { name: "+ new session", key: ['aside button[aria-label="New session"]'] },
  { name: "settings", key: ["aside button", "Iridium"] },
  { name: "settings→page", pre: async (p) => (await press(p, "aside button", { text: "Iridium" }), await sleep(500)), key: ["[data-settings-dialog] button", "Roles"], watch: "same" },
  { name: "work step", pre: async (p) => (await enter(p, "main [role=log] button", "steps"), await sleep(500)), key: ["main [role=log] button", "grep"], how: "key" },
  { name: "@ list", key: ["textarea"], how: "type", keys: "@" },
  { name: "/ list", chat: "solo", key: ["textarea"], how: "type", keys: "/" },
  { name: "phone: card", phone: true, key: [FACE] },
  { name: "phone: ⋯ menu", phone: true, key: [MORE] },
  // Shut by a tap on the conversation above it (app.tsx), opened again by its key.
  { name: "phone: sessions sheet", phone: true, key: ['button[aria-label="Session list"]'], watch: "sheet", shutAt: { x: 195, y: 160 } },
  { name: "phone: settings sheet", phone: true, pre: async (p) => (await press(p, MORE), await sleep(400)), key: [ITEM, "Settings"], watch: "sheet" },
];

async function open(page, s, { quick = false } = {}) {
  const [sel, text] = s.key;
  if (s.how === "key") {
    await focusOn(page, sel, text);
    await page.evaluate((m, t) => window.__pop.mark(m, t), s.watch ?? "new", s.text ?? "");
    await page.evaluate(() => window.__pop.start());
    return page.keyboard.press("Enter");
  }
  let at = await where(page, sel, text, 30000);
  if (at.moved) (await sleep(400), (at = await where(page, sel, text)));
  await page.evaluate((m, t) => window.__pop.mark(m, t), s.watch ?? "new", s.text ?? "");
  await page.evaluate(() => window.__pop.start());
  await page.mouse.move(at.x, at.y);
  if (!quick) await sleep(30);
  if (s.how === "hover") {
    await page.evaluate(() => window.__pop.presses.push(performance.now()));
  } else if (s.how === "type") {
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.type(s.keys);
  } else {
    const button = s.how === "right" ? "right" : "left";
    await page.mouse.down({ button });
    await page.mouse.up({ button });
  }
}

/** P1 (and P3 in the normal run): frames from the press to 1500ms after, then shut by Esc. */
async function p1(s, mode) {
  const { ctx, page } = await fresh({ phone: s.phone, slow: mode !== "normal" });
  try {
    await load(page, s.chat);
    await ready(page);
    if (mode !== "immediate") await sleep(2000);
    if (s.pre) await s.pre(page);
    await open(page, s, { quick: mode === "immediate" });
    await sleep(1500);
    if (process.env.SHOT) await page.screenshot({ path: `/tmp/pop-${s.name.replace(/\W+/g, "_")}-${mode}.png` });
    const got = await page.evaluate(() => window.__pop.stop());
    let shut = null;
    if (mode === "normal") {
      await page.evaluate(() => window.__pop.start());
      await esc(page);
      await sleep(450);
      shut = await page.evaluate(() => window.__pop.stop());
    }
    return { got, shut };
  } finally {
    await ctx.close();
  }
}

/** P1: from its first frame drawn after the press (with "same", a page put in it: the first frame
 *  of the new page, its size changed once at the press), how much its box changed after. */
function sizeJudge(F, presses, same) {
  const t0 = presses.at(-1) ?? F[0]?.t ?? 0;
  let seen = F.filter((f) => f.on && f.t >= t0 - 1);
  if (same) {
    const was = F.filter((f) => f.on && f.t < t0).at(-1) ?? seen[0];
    const at = seen.findIndex((f) => f.w !== was?.w || f.h !== was?.h);
    if (at > 0) seen = seen.slice(at);
  }
  const first = seen.find((f) => f.op > 0);
  if (!first) return { found: false };
  const after = seen.filter((f) => f.t >= first.t && f.t <= first.t + 1500);
  const dw = Math.max(...after.map((f) => Math.abs(f.w - first.w)));
  const dh = Math.max(...after.map((f) => Math.abs(f.h - first.h)));
  const last = after.at(-1);
  return { found: true, w: first.w, h: first.h, dw, dh, endW: last.w, endH: last.h, frames: after.length };
}
/** P3: its layout box and its place less the transform, over the frames it moves (opacity or scale not at rest). */
function layoutJudge(F) {
  const on = F.filter((f) => f.on);
  if (on.length < 2) return null;
  const rest = on.at(-1).ty;
  const moving = on.filter((f) => f.op < 0.999 || Math.abs(f.sc - 1) > 0.001 || Math.abs(f.ty - rest) > 0.5);
  const set = moving.length >= 2 ? moving : on.slice(0, 3);
  const d = (k) => Math.max(...set.map((f) => Math.abs(f[k] - set[0][k])));
  return { frames: set.length, dw: r1(d("w")), dh: r1(d("h")), dx: r1(d("x")), dy: r1(d("y")) };
}

/** P2: each press's frames to its opacity or its scale going the new way (dirs: +1 open, -1 shut;
 *  gone counts as shut). */
function turnJudge(F, presses, dirs) {
  return presses.slice(0, dirs.length).map((tp, i) => {
    const before = F.filter((f) => f.t < tp).at(-1);
    const after = F.filter((f) => f.t >= tp);
    let prev = before?.on ? before : { op: 0, sc: 0.96, ty: 0 };
    for (let j = 0; j < Math.min(after.length, 12); j++) {
      const now = after[j].on ? after[j] : { op: 0, sc: 0.96, ty: 0, gone: true };
      // Opening: more opaque, larger, or (a sheet) up.
      if ((now.op - prev.op) * dirs[i] > 0.004 || (now.sc - prev.sc) * dirs[i] > 0.0005 || (prev.ty - now.ty) * dirs[i] > 0.5 || (dirs[i] < 0 && now.gone && before?.on)) return j + 1;
      prev = now;
    }
    return null;
  });
}

async function p2(s) {
  const { ctx, page } = await fresh({ phone: s.phone });
  try {
    await load(page, s.chat);
    await ready(page);
    await sleep(2000);
    const [sel, text] = s.key;
    const at = await where(page, sel, text, 30000);
    await page.evaluate((m, t) => window.__pop.mark(m, t), s.watch ?? "new", s.text ?? "");
    await page.evaluate(() => window.__pop.start());
    await page.mouse.move(at.x, at.y);
    const t0 = Date.now();
    const until = (ms) => sleep(Math.max(0, ms - (Date.now() - t0)));
    const button = s.how === "right" ? "right" : "left";
    const hit = async () => (await page.mouse.down({ button }), await page.mouse.up({ button }));
    if (s.how === "type") {
      await hit();
      await page.keyboard.type(s.keys);
      await until(60);
      await page.keyboard.press("Backspace");
      await until(120);
      await page.keyboard.type(s.keys);
    } else if (s.how === "right") {
      // A context menu: shut by Esc, opened again by the right button.
      await hit();
      await until(60);
      await esc(page);
      await until(120);
      await hit();
    } else if (s.shutAt) {
      await hit();
      await until(60);
      await page.mouse.move(s.shutAt.x, s.shutAt.y);
      await hit();
      await until(120);
      await page.mouse.move(at.x, at.y);
      await hit();
    } else {
      await hit();
      await until(60);
      await hit();
      await until(120);
      await hit();
    }
    await sleep(700);
    const got = await page.evaluate(() => window.__pop.stop());
    // The presses that open and shut: a key typed or pressed (a mouse press is one pointerdown).
    const presses = s.how === "type" ? [got.presses.at(-3), got.presses.at(-2), got.presses.at(-1)] : got.presses.slice(-3);
    const resp = turnJudge(got.F, presses, [1, -1, 1]);
    if (process.env.TRACE) console.log(JSON.stringify({ presses: got.presses.map((p) => r1(p - presses[0])), F: got.F.map((x) => [r1(x.t - presses[0]), x.on ? r1(x.op) : "-", x.on ? r1(x.sc * 100) / 100 : "", x.ending ? "E" : ""]) }));
    const last = got.F.at(-1);
    const isOpen = s.watch === "sheet" ? last?.ty < 1 : last?.on && last.op > 0.98 && !last.ending;
    return { at: presses.map((p) => r1(p - presses[0])), frames: resp, end: isOpen ? "open" : "NOT open", late: got.late };
  } finally {
    await ctx.close();
  }
}

/** P2 with two keys: A open, A pressed to shut and B 60ms after; or A pressed and outside at 60ms. */
async function p2pair(name, a, b) {
  const { ctx, page } = await fresh();
  try {
    await load(page);
    await ready(page);
    await sleep(2000);
    const pa = await where(page, a);
    await page.mouse.move(pa.x, pa.y);
    if (b) {
      await page.mouse.down();
      await page.mouse.up();
      await sleep(400);
    }
    await page.evaluate(() => window.__pop.mark("new"));
    await page.evaluate(() => window.__pop.start());
    const t0 = Date.now();
    await page.mouse.down();
    await page.mouse.up();
    await sleep(Math.max(0, 60 - (Date.now() - t0)));
    if (b) {
      const pb = await where(page, b);
      await page.evaluate(() => window.__pop.mark("new"));
      await page.mouse.move(pb.x, pb.y);
    } else await page.mouse.move(700, 450);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(700);
    const got = await page.evaluate(() => window.__pop.stop());
    const open = await page.evaluate(() => [...document.querySelectorAll(".g-unfold:is([role=menu],[role=dialog])")].filter((e) => !e.hasAttribute("data-ending-style")).length);
    const last = got.F.at(-1);
    if (b) return { name, frames: turnJudge(got.F, got.presses.slice(-1), [1]), end: last?.on && last.op > 0.98 && open === 1 ? "second open, alone" : `second ${last?.on ? "there" : "not there"}, ${open} open` };
    return { name, frames: turnJudge(got.F, got.presses.slice(-2), [1, -1]), end: open === 0 ? "shut" : `${open} open` };
  } finally {
    await ctx.close();
  }
}

const f = (row, m) => (row[m] ? (row[m].found ? `${row[m].w}x${row[m].h} Δ${row[m].dw}/${row[m].dh}${row[m].late?.length ? " late " + row[m].late.join(",") : ""}` : "not found") : "-");
for (const s of SCENES) {
  if (only.size && !only.has(s.name)) continue;
  const row = { name: s.name };
  try {
    if (!onlyP2) {
      for (const mode of ["normal", "after-idle", "immediate"]) {
        const { got, shut } = await p1(s, mode);
        row[mode] = sizeJudge(got.F, got.presses, s.watch === "same");
        row[mode].late = got.late;
        if (mode === "normal") row.p3 = { open: layoutJudge(got.F.filter((x) => x.t <= (got.presses.at(-1) ?? 0) + 400)), shut: shut && layoutJudge(shut.F) };
      }
    }
    if (!onlyP1 && !s.pre && s.how !== "hover" && s.how !== "key") row.p2 = await p2(s);
  } catch (e) {
    row.error = String(e.message ?? e).slice(0, 200);
  }
  results.push(row);
  console.log(
    `${s.name.padEnd(18)} P1 ${f(row, "normal").padEnd(22)}| ${f(row, "after-idle").padEnd(22)}| ${f(row, "immediate").padEnd(22)}` +
      (row.p3 ? ` P3 open ${JSON.stringify(row.p3.open)} shut ${JSON.stringify(row.p3.shut)}` : "") +
      (row.p2 ? ` P2 ${JSON.stringify(row.p2)}` : "") +
      (row.error ? ` ERROR ${row.error}` : ""),
  );
}
if (!onlyP1 && !only.size) {
  for (const [name, a, b] of [
    ["members, then ⋯ as it shuts", MEMBERS, MORE],
    ["context, then quota as it shuts", 'main [role=log] button[aria-label^="Context"]', 'main [role=log] button[aria-label^="Quota"]'],
    ["members, outside at 60ms", MEMBERS, null],
  ]) {
    const pr = await p2pair(name, a, b).catch((e) => ({ name, error: String(e.message ?? e).slice(0, 200) }));
    results.push(pr);
    console.log(`${name.padEnd(32)} P2 ${JSON.stringify(pr)}`);
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
await browser.close();
