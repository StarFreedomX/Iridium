// scen.mjs ENGINE: the conversation's movement in a set of scenes, by what was painted each frame.
import { chromium, webkit } from "playwright-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [engine = "chromium", only = ""] = process.argv.slice(2);
const H = "/tmp/irperf", R = `${H}/run`;
const url = `http://127.0.0.1:${fs.readFileSync(`${R}/port`, "utf8").trim()}/`;
const ids = Object.fromEntries(fs.readFileSync(`${R}/ids`, "utf8").trim().split("\n").map((l) => l.split(" ")));
const S = ids[5];
const env = Object.fromEntries(fs.readFileSync(`${R}/env`, "utf8").replace("export ", "").trim().split(" ").map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]));
const ir = (...a) => execFileSync(`${R}/ir`, a, { env: { ...process.env, ...env }, encoding: "utf8" });
const opts = { viewport: { width: 1100, height: 900 }, serviceWorkers: "block" };
const b = await (engine === "webkit" ? webkit : chromium).launch(engine === "chromium" ? { executablePath: "/home/iridium/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome", args: ["--no-sandbox"] } : {});
const p = await b.newPage(opts);
p.on("pageerror", (e) => console.log("ERR", e.message.slice(0, 300)));
await p.goto(url + "?lang=en#/s/" + S); await p.waitForTimeout(3000);
await p.evaluate(() => {
  const el = () => document.querySelector("main [role=log]");
  let ref = null, F = [], on = false;
  const f = () => { if (!on) return; const e = el(); if (!e || !ref || !ref.isConnected) return; F.push([Math.round(performance.now()), Math.round(ref.getBoundingClientRect().top * 10) / 10, Math.round(e.scrollTop), Math.round(e.scrollHeight)]); };
  const ch = new MessageChannel(); ch.port1.onmessage = f;
  const tick = () => (ch.port2.postMessage(0), requestAnimationFrame(tick)); requestAnimationFrame(tick);
  // The row to watch: the last one wholly seen above the middle of the pane, or the one given.
  window.__start = (sel) => { const e = el(); const mid = e.getBoundingClientRect().top + e.clientHeight * 0.55; const rows = [...e.firstElementChild.children]; ref = (sel && e.querySelector(sel)) || rows.reverse().find((r) => { const b = r.getBoundingClientRect(); return b.height > 0 && b.bottom <= mid; }) || rows[0]; F = []; on = true; window.__m0 = (window.__moves || []).length; };
  window.__stop = () => { on = false; let up = 0, down = 0, path = 0, turns = 0, dir = 0; const downs = []; for (let i = 1; i < F.length; i++) { const d = F[i][1] - F[i - 1][1]; if (Math.abs(d) < 1.2) continue; path += Math.abs(d); if (d < 0) up++; else { down++; downs.push({ t: F[i][0], d: Math.round(d * 10) / 10, top: F[i][2] - F[i - 1][2], h: F[i][3] - F[i - 1][3], near: (window.__moves || []).filter((x) => !x.who.startsWith("css.animation") && x.t > F[i][0] - 120 && x.t < F[i][0] + 40).map((x) => `${x.t} ${x.who} ${x.why} ${x.dy ?? ""} ${x.note ?? ""}`) }); } const s = Math.sign(d); if (dir && s !== dir) turns++; dir = s; } const net = F.length ? F.at(-1)[1] - F[0][1] : 0; const m = (window.__moves || []).slice(window.__m0).filter((x) => !x.who.startsWith("css.animation")); const by = {}; for (const x of m) by[x.who + " " + x.why] = (by[x.who + " " + x.why] || 0) + 1; return { frames: F.length, up, down, turns, net: Math.round(net), path: Math.round(path), ratio: net ? Math.round((path / Math.abs(net)) * 100) / 100 : path ? Infinity : 1, top: F.at(-1)?.[2], moves: by, downs: window.__wantDown ? [] : downs.slice(0, 4), ref: (ref?.getAttribute("data-flip") || "").slice(0, 16) }; };
});
const start = (sel) => p.evaluate((s) => window.__start(s), sel ?? null);
const stop = () => p.evaluate(() => window.__stop());
const out = {};
const scene = async (name, want, f) => { if (only && only !== name) return; try { const r = await f(); const bad = want(r); out[name] = { ok: !bad, ...(bad ? { bad } : {}), ...r }; } catch (e) { out[name] = { ok: false, bad: String(e.message).split("\n")[0] }; } console.log(name, JSON.stringify(out[name])); };
const upOnly = (r) => (r.down ? `${r.down} frames down` : r.turns ? `${r.turns} turns` : "");
const downOnly = (r) => (r.up ? `${r.up} frames up` : r.turns ? `${r.turns} turns` : "");
const still = (r) => (r.path > 1 ? `moved ${r.path}px` : "");
const box = p.locator("main textarea").first();

await scene("turn", upOnly, async () => { await start(); ir("api", "message.create", `channel_id=${S}`, "content=@Bee walk me through it STREAM"); await p.waitForTimeout(13000); return stop(); });
await scene("send", upOnly, async () => { await start(); await box.click(); await p.keyboard.type("a word of mine (say nothing)"); await p.keyboard.press("Enter"); await p.waitForTimeout(2500); return stop(); });
await scene("composer-grow", upOnly, async () => { await box.click(); await start(); for (let i = 0; i < 5; i++) { await p.keyboard.type("line " + i); await p.keyboard.down("Shift"); await p.keyboard.press("Enter"); await p.keyboard.up("Shift"); await p.waitForTimeout(120); } await p.waitForTimeout(900); return stop(); });
await scene("composer-shrink", downOnly, async () => { await start(); await p.keyboard.press("Control+A"); await p.keyboard.press("Backspace"); await p.waitForTimeout(1200); return stop(); });
// A fold seen in the pane, pressed where it is (no scrolling to it).
const foldAt = () => p.evaluate(() => { const e = document.querySelector("main [role=log]"); const v = e.getBoundingClientRect(); const s = [...e.querySelectorAll("summary")].reverse().find((x) => { const r = x.getBoundingClientRect(); return r.top > v.top + 80 && r.bottom < v.bottom - 160 && r.width > 0; }); if (!s) return null; const r = s.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
await scene("fold-open", upOnly, async () => { const at = await foldAt(); if (!at) return { skipped: "no fold in view", up: 0, down: 0, turns: 0 }; await start(); await p.mouse.click(at.x, at.y); await p.waitForTimeout(1200); const r = await stop(); r.at = at; return r; });
await scene("fold-shut", downOnly, async () => { const at = out["fold-open"]?.at; if (!at) return { skipped: "no fold in view", up: 0, down: 0, turns: 0 }; const now = await foldAt(); await start(); await p.mouse.click((now ?? at).x, (now ?? at).y); await p.waitForTimeout(1500); return stop(); });
await scene("gone-up", still, async () => { await p.mouse.move(600, 400); await p.mouse.wheel(0, -700); await p.waitForTimeout(800); await start(); ir("api", "message.create", `channel_id=${S}`, "content=@Bee walk me through it STREAM"); await p.waitForTimeout(12500); const r = await stop(); r.key = await p.locator("main button:has-text('New')").count(); return r; });
await scene("back-down", () => "", async () => { const k = p.locator("main button:has-text('New')"); if (await k.count()) await k.first().click(); else await p.evaluate(() => { const e = document.querySelector("main [role=log]"); e.scrollTo({ top: e.scrollHeight }); }); await p.waitForTimeout(1500); return p.evaluate(() => { const e = document.querySelector("main [role=log]"); return { gap: Math.round(e.scrollHeight - e.clientHeight - e.scrollTop) }; }); });
await scene("turn-again", upOnly, async () => { await start(); ir("api", "message.create", `channel_id=${S}`, "content=@Bee walk me through it STREAM"); await p.waitForTimeout(13000); return stop(); });
await scene("place-kept", (r) => (Math.abs(r.was - r.now) > 2 ? `left at ${r.was}, back at ${r.now}` : ""), async () => { await p.mouse.move(600, 400); await p.mouse.wheel(0, -900); await p.waitForTimeout(800); const was = await p.evaluate(() => document.querySelector("main [role=log]").scrollTop); await p.goto(url + "?lang=en#/s/" + ids[4]); await p.waitForTimeout(1200); await p.goto(url + "?lang=en#/s/" + S); await p.waitForTimeout(1500); const now = await p.evaluate(() => document.querySelector("main [role=log]").scrollTop); return { was: Math.round(was), now: Math.round(now) }; });
const bad = Object.entries(out).filter(([, v]) => !v.ok).map(([k]) => k);
console.log(bad.length ? `\nFAILED: ${bad.join(", ")}` : "\nall scenes pass");
await b.close();
