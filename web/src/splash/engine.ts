// The splash's drawing (splash.tsx; kumo, 2026-11-25): a band of code in small characters, each
// cell of it as dark and as coloured as the figure behind it is there, so that the characters
// draw the figure: Iridium's letters, an agent's mark, a face. It moves only as something
// changes: the code flows for a moment as the band comes and as its figure changes, the cells
// going over to the new figure from its middle outwards; the characters about the pointer
// change as it passes. Otherwise nothing is drawn again.
import type { Agent } from "../api/types.gen";
import { AGY_DATA_URI, CLAUDE, DSH, DSH_VIEWBOX, OPENAI, OPENAI_VIEWBOX, PI, PI_VIEWBOX } from "../logos";
import { STANDARD, type Fig } from "./figure";

const FONT_PX = 8; // px; a narrow band's (fine): 7
const ROW_PX = 9; // px, a row's height; fine: 8
const SRC = 256; // px, the figure as it is drawn before the cells are read from it
const BASE = 0.12; // a cell's opacity with no figure on it
const TURN = 700; // ms, one cell going over
const SPREAD = 650; // ms, from the middle's first cell to the rim's
const NEAR = 60; // px about the pointer
const IDLE = 0.4; // the flow's speed with nothing happening, of its speed as something does
const GLYPHS = "abcdefghijklmnopqrstuvwxyz0123456789{}[]()<>=+-*/&|!?:;.,_#$%@~^";
const WORDS = ["mygo", "satori", "iridium"];
const CODE = [
  "func (s *Server) Serve(ctx context.Context) error {",
  "for ev := range ch.events {",
  "if err != nil { return fmt.Errorf(\"open: %w\", err) }",
  "select { case <-ctx.Done(): return ctx.Err() }",
  "msg := &Message{ID: next(), Channel: ch.id, Text: text}",
  "defer mu.Unlock()",
  "go func() { defer wg.Done(); run(ctx, a) }()",
  "type Member struct { Nick string; Agent string; On []Trigger }",
  "const rows = useMemo(() => fold(log.msgs), [log.end])",
  "export function open(id: string): void {",
  "await api.send(id, { text, files })",
  "return list.filter((x) => x.cwd === cwd)",
  "switch ev.Type { case \"message-created\":",
  "w.Header().Set(\"Content-Type\", \"application/json\")",
  "if !ok { http.Error(w, \"not found\", 404); return }",
  "for (const m of members) wake(m, msg)",
  "ch <- Event{Seq: seq, At: time.Now()}",
  "const [open, setOpen] = useState(false)",
  "tx, err := db.BeginTx(ctx, nil)",
  "import { useEffect, useRef } from \"react\"",
  "git commit -m \"channel: one message, said once\"",
  "ir api message.create channel_id=$id content=ok",
  "session.resume(id).then(stream)",
  "func holder(sock string) (*Conn, error) {",
  "$ ir run --secret token -- deploy",
  "case <-time.After(30 * time.Second):",
  "let seq = 0; const heard = new Set()",
  "rows, err := q.Query(ctx, `select seq, text from messages`)",
  "useLayoutEffect(() => measure(ref.current), [])",
  "token := r.Header.Get(\"Authorization\")",
];

/** The flow's speed for an effort (0 to 1), of its own: 1 at the standard one (high), up to
 *  2.2 times at the most, down to half at the least. */
const pace = (p: number) => (p <= STANDARD ? 0.45 + (p / STANDARD) * 0.55 : 1 + Math.pow((p - STANDARD) / (1 - STANDARD), 1.3) * 1.2);

type RGB = [number, number, number];
type Field = { a: Float32Array; r: Float32Array; g: Float32Array; b: Float32Array };
const field = (n: number): Field => ({ a: new Float32Array(n), r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) });
const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);

/** One row's code: lines one after another, a word of ours among them now and then (seldom: to
 *  be come upon, not read). */
function line(n: number): string[] {
  let s = "";
  while (s.length < n) s += (Math.random() < 1 / 70 ? WORDS[(Math.random() * WORDS.length) | 0]! : CODE[(Math.random() * CODE.length) | 0]!) + "  ";
  return [...s.slice(0, n)];
}

/** An agent's mark on a square of SRC, in ink where it is drawn in the text's colour. */
function mark(g: CanvasRenderingContext2D, agent: Agent, ink: string): boolean {
  const box = (vb: string) => {
    const [x, y, w, h] = vb.split(" ").map(Number) as [number, number, number, number];
    const k = (SRC * 0.8) / Math.max(w, h);
    g.translate(SRC / 2 - (x + w / 2) * k, SRC / 2 - (y + h / 2) * k);
    g.scale(k, k);
  };
  const paths: [string, string][] = agent === "claude" ? [["#D97757", CLAUDE]] : agent === "codex" ? [[ink, OPENAI]] : agent === "pi" ? PI : agent === "dsh" ? [[ink, DSH]] : [];
  if (!paths.length) return false;
  g.save();
  box(agent === "claude" ? "0 0 24 24" : agent === "codex" ? OPENAI_VIEWBOX : agent === "pi" ? PI_VIEWBOX : DSH_VIEWBOX);
  for (const [fill, d] of paths) {
    g.fillStyle = fill;
    g.fill(new Path2D(d));
  }
  g.restore();
  return true;
}

/** A colour of the rainbow at hue h (degrees), bright. */
function rainbowAt(h: number): RGB {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (0.55 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

/** Iridium's letters (ui.tsx IrMark's, with no square about them), in a rainbow. */
function letters(g: CanvasRenderingContext2D, ink: string) {
  const k = (SRC * 0.78) / 28;
  g.save();
  g.translate(SRC / 2 - 32 * k, SRC / 2 - 32 * k);
  g.scale(k, k);
  // A rainbow across them (kumo, 2026-11-25: RGB, every colour), not the text's ink.
  void ink;
  const paint = g.createLinearGradient(20, 18, 44, 46);
  ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#32ade6", "#007aff", "#af52de"].forEach((c, i, all) => paint.addColorStop(i / (all.length - 1), c));
  g.fillStyle = paint;
  g.fill(new Path2D("M20 18h6v28h-6zM32 28h5.6v3.2c1.4-2.4 3.6-3.6 6.4-3.6v5.8c-3.8 0-6.2 1.6-6.2 6V46H32z"));
  g.restore();
}

const loaded = new Map<string, Promise<HTMLImageElement | null>>();
function picture(src: string): Promise<HTMLImageElement | null> {
  let p = loaded.get(src);
  if (!p) {
    p = new Promise((done) => {
      const img = new Image();
      img.onload = () => done(img.naturalWidth ? img : null);
      img.onerror = () => done(null);
      img.src = src;
    });
    loaded.set(src, p);
  }
  return p;
}
/** A figure's picture asked for ahead (a row of the + panel as it is drawn). */
export const ahead = (f: Fig) => void (f.src && picture(f.src));

// The band as one left it, for the next one of its size within a moment: the empty pane's band
// goes on in the channel made from it, the same characters where they were, nothing coming in
// anew (kumo, 2026-11-25: it blinked).
let kept: { at: number; cols: number; rows: number; text: string[][]; off: Float32Array<ArrayBuffer>; speed: Float32Array<ArrayBuffer>; cur: Field; key: string } | null = null;

export type Splash = { leave(done: () => void): void; enter(): void; figure(f: Fig | null): void; place(x: number, side: number, y?: number): void; foot(y: number): void; window(middle: number, height: number): void; recolor(): void; power(f: number): void; resize(): void; near(x: number, y: number): void; stop(): void };

/** fine: smaller characters, more of them to a figure (the portrait layout, where the band is
 *  narrow and a figure of few cells is a blur: kumo, 2026-11-25). */
export function splash(cv: HTMLCanvasElement, still: boolean, fine = false): Splash {
  const FONT = fine ? 7 : FONT_PX, ROW = fine ? 8 : ROW_PX;
  const g = cv.getContext("2d")!;
  const src = document.createElement("canvas");
  src.width = src.height = SRC;
  const sg = src.getContext("2d", { willReadFrequently: true })!;
  const small = document.createElement("canvas");
  const mg = small.getContext("2d", { willReadFrequently: true })!;
  const tiny = document.createElement("canvas");
  const tg = tiny.getContext("2d")!;

  let W = 0, H = 0, dpr = 1, cw = 5.4, cols = 0, rows = 0, len = 0;
  let cur = field(0), from = field(0), to = field(0);
  let busy = new Uint8Array(0), over: string[] = [], overAt = new Float64Array(0), wasTurning = false;
  let wait = new Float32Array(0), heat = new Float32Array(0), off = new Float32Array(0), speed = new Float32Array(0);
  let text: string[][] = [];
  let ink: RGB = [34, 34, 34], dark = false;
  // The effort slider's level (0 to 1), and where the figure's middle is and how large it is:
  // each as asked (pwT; cx, most: -1 the band's own middle) and as drawn now (pw; px, ps), the
  // drawn gliding to the asked, never set over to it in one frame (kumo, 2026-11-25: it twitched).
  let pw = STANDARD, pwT = STANDARD;
  let cx = -1, most = 0, px = -1, ps = 0;
  let cy = -1, py = -1; // its middle's height: asked (-1: the window's own middle) and drawn
  // Where the figure's lowest edge is to stand (-1: none asked): on the composer (kumo, 2026-11-25:
  // Ir's letters stand on its top, as on a line). below: how far under the square's middle what
  // is drawn in it ends, a share of its side (the letters 0.39, a face 0.47, a mark 0.4).
  let footT = -1, below = 0.39;
  const yGoal = (gc: number, gs: number) => (footT >= 0 ? footT - below * gs : cy < 0 ? gc : cy);
  // As the page is laid out (its first second), what is asked of the place is there at once, not
  // glided to: it moved about as the page settled (kumo, 2026-11-25).
  const born = performance.now();
  const settling = () => performance.now() - born < 1200;
  // The window (kumo, 2026-11-25): the code is over the whole canvas, each row where it is, and
  // only the rows in the window are seen, fading out to its upper and lower edge. Moved, the
  // window goes over the rows, those it leaves fading and those it comes to coming up: the
  // characters do not move with it. Its middle and height, asked (-1: the canvas's own) and drawn.
  let wcT = -1, whT = -1, wc = 0, wh = 0;
  // The figure's own cells are seen whole, in the window's fading edges and past them too (kumo,
  // 2026-11-25: the figure was cut off by them): how much of each cell is the figure's (fm), and
  // the most of it in each row (fr).
  let fm = new Float32Array(0), fr = new Float32Array(0);
  const winGoal = (): [number, number] => (wcT < 0 ? [H / 2, H] : [wcT, whT]);
  /** How much of a row at height y is seen: all of it in the window's middle half, none at its edges. */
  const seen = (y: number) => {
    const d = Math.abs(y - wc) / (wh / 2 || 1);
    if (d >= 1) return 0;
    if (d <= 0.52) return 1;
    const t = (1 - d) / 0.48;
    return t * t * (3 - 2 * t);
  };
  let vel = 0, wasGliding = false, tick = 0, calm = false, odd = false;
  let leaving: (() => void) | null = null, left = false, spreadNow = SPREAD;
  const goal = (): [number, number] => (cx < 0 ? [W / 2, Math.min((whT < 0 ? H : whT) * 0.92, W * 0.7)] : [cx, most]);
  // Iridium's letters drawn: their cells' colours flow through the rainbow each frame (kumo,
  // 2026-11-25: a gradient that moves).
  let rainbow = false;
  let fig: Fig | null = null, photo = false, drawnKey = "", asked = 0;
  let t0 = -1e9, flowTo = 0, last = 0, raf = 0, hot = false, first = true, dead = false;

  const inkNow = () => {
    const c = getComputedStyle(cv).color;
    sg.clearRect(0, 0, 1, 1);
    sg.fillStyle = c;
    sg.fillRect(0, 0, 1, 1);
    const d = sg.getImageData(0, 0, 1, 1).data;
    ink = [d[0]!, d[1]!, d[2]!];
    dark = 0.3 * ink[0] + 0.59 * ink[1] + 0.11 * ink[2] > 128;
    return `rgb(${ink.join(",")})`;
  };

  /** The figure on the square (src); photo: a picture, its tones kept, not a flat mark. */
  const paint = async (f: Fig | null): Promise<boolean> => {
    const css = inkNow();
    rainbow = false;
    const face = (f?.src ? await picture(f.src) : null) ?? (f?.alt ? await picture(f.alt) : null);
    const img = face ?? (f?.agent === "agy" ? await picture(AGY_DATA_URI) : null);
    sg.clearRect(0, 0, SRC, SRC);
    if (img && face) {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      sg.save();
      sg.beginPath();
      sg.arc(SRC / 2, SRC / 2, SRC * 0.47, 0, 7);
      sg.clip();
      sg.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, SRC * 0.03, SRC * 0.03, SRC * 0.94, SRC * 0.94);
      sg.restore();
      below = 0.47;
      return true;
    }
    below = 0.4;
    if (img) sg.drawImage(img, SRC * 0.1, SRC * 0.1, SRC * 0.8, SRC * 0.8);
    else if (!f?.agent || !mark(sg, f.agent, css)) (letters(sg, css), (below = 0.39), (rainbow = true));
    return false;
  };

  /** Each cell's opacity and colour for the square as it is painted. */
  const read = (): Field => {
    const n = cols * rows, out = field(n);
    if (!n) return out;
    const mid = px, side = ps, fx = mid - side / 2, fy = py - side / 2;
    small.width = cols;
    small.height = rows;
    mg.imageSmoothingQuality = "high";
    // Through a half-size step: one step down from SRC skipped pixels, a mark's thin rays gone.
    tiny.width = cols * 3;
    tiny.height = rows * 3;
    tg.imageSmoothingQuality = "high";
    tg.drawImage(src, (fx / cw) * 3, (fy / ROW) * 3, (side / cw) * 3, (side / ROW) * 3);
    mg.drawImage(tiny, 0, 0, cols, rows);
    const sharp = mg.getImageData(0, 0, cols, rows).data;
    // No halo about the figure (kumo, 2026-11-25: the colours spread about it, and the code there
    // lighter): the code about it as all the rest is.
    const vivid = (r: number, g: number, b: number, k: number, gain: number): RGB => {
      const m = (r + g + b) / 3;
      return [clamp((m + (r - m) * k) * gain, 0, 255), clamp((m + (g - m) * k) * gain, 0, 255), clamp((m + (b - m) * k) * gain, 0, 255)];
    };
    if (fm.length !== n) fm = new Float32Array(n);
    if (fr.length !== rows) fr = new Float32Array(rows);
    fr.fill(0);
    for (let i = 0; i < n; i++) {
      const o = i * 4, m = sharp[o + 3]! / 255;
      fm[i] = m;
      if (m > fr[(i / cols) | 0]!) fr[(i / cols) | 0] = m;
      let a = BASE, c: RGB = ink;
      // A picture (a face): the code about it goes out from its rim to none, the face alone
      // (kumo, 2026-11-25); about letters or a mark the code is as everywhere.
      if (photo && m <= 0.5) {
        const d = Math.hypot(((i % cols) + 0.5) * cw - mid, (((i / cols) | 0) + 0.5) * ROW - py) - side * 0.47;
        a = BASE * clamp(1 - d / (side * 0.09));
      }
      if (photo && m > 0.5) {
        const lum = (0.3 * sharp[o]! + 0.59 * sharp[o + 1]! + 0.11 * sharp[o + 2]!) / 255;
        a = (0.3 + 0.7 * Math.pow(dark ? lum : 1 - lum, 0.75)) * (0.7 + 0.3 * pw);
        c = vivid(sharp[o]!, sharp[o + 1]!, sharp[o + 2]!, 1.5, dark ? 1.2 : 0.85);
      } else if (!photo && m > 0) {
        c = [ink[0] + (sharp[o]! - ink[0]) * m, ink[1] + (sharp[o + 1]! - ink[1]) * m, ink[2] + (sharp[o + 2]! - ink[2]) * m];
        a = BASE + m * (0.42 + 0.4 * pw);
      }
      out.a[i] = a;
      out.r[i] = c[0];
      out.g[i] = c[1];
      out.b[i] = c[2];
    }
    return out;
  };

  const draw = () => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = `${FONT}px ui-monospace, "SF Mono", Menlo, "JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace`;
    g.textBaseline = "top";
    // The rainbow's place now: across the figure, moving on as time goes.
    const shift = still ? 0 : performance.now() * 0.06, fx0 = px - ps / 2, span = ps || 1;
    for (let r = 0; r < rows; r++) {
      const o = Math.floor(off[r]!), f = off[r]! - o, row = text[r]!, y = r * ROW + 0.5;
      const env = seen(y + ROW / 2);
      let warm = false;
      for (let k = 0; k < cols && !warm; k++) warm = heat[r * cols + k]! > 0.02;
      if (env < 0.01 && fr[r]! < 0.01 && !warm) continue;
      let run = "", at = 0, key = -1;
      const flush = () => {
        if (!run || !(key & 31)) return;
        g.fillStyle = `rgba(${((key >> 5) & 31) << 3},${((key >> 10) & 31) << 3},${((key >> 15) & 31) << 3},${(key & 31) / 24})`;
        g.fillText(run, (at - f) * cw, y);
      };
      for (let k = 0; k < cols; k++) {
        const i = r * cols + k;
        let cr = cur.r[i]!, cg = cur.g[i]!, cb = cur.b[i]!;
        const fmi = rainbow ? (fm[i] ?? 0) : 0;
        if (fmi > 0) {
          const [hr, hg, hb] = rainbowAt(((((k + 0.5) * cw - fx0) / span) * 300 + (r * ROW - py) * 0.4 - shift) % 360 + 360);
          (cr += (hr - cr) * fmi), (cg += (hg - cg) * fmi), (cb += (hb - cb) * fmi);
        }
        // About the pointer a lens (kumo, 2026-11-25): the code there seen wherever it is, past the
        // band's edges or a face's rim too, and drawn larger, one character at a time.
        const hi = heat[i]!;
        if (hi > 0.08) {
          flush();
          run = "";
          key = -1;
          const ch = row[(k + o) % len] ?? " ";
          const z = 1 + 0.9 * hi;
          g.font = `${FONT * z}px ui-monospace, "SF Mono", Menlo, "JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace`;
          g.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${clamp(BASE + 0.15 + hi * 0.6)})`;
          g.fillText(ch, (k - f) * cw - (cw * (z - 1)) / 2, y - (ROW * (z - 1)) / 2);
          g.font = `${FONT}px ui-monospace, "SF Mono", Menlo, "JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace`;
          at = k + 1;
          continue;
        }
        const k2 = Math.min(24, Math.round(clamp(cur.a[i]! + hi * 0.34) * (env + (1 - env) * Math.max(fm[i] ?? 0, hi)) * 24)) | ((cr >> 3) << 5) | ((cg >> 3) << 10) | ((cb >> 3) << 15);
        if (k2 !== key) {
          flush();
          run = "";
          at = k;
          key = k2;
        }
        // On the way a cell is another character, one cell in four, changed eight times a second:
        // not a new one each frame.
        const h = busy[i] ? Math.imul(i ^ Math.imul(tick, 0x9e3779b1), 0x85ebca6b) >>> 0 : 1;
        run += h % 4 === 0 ? GLYPHS[(h >>> 8) % GLYPHS.length]! : (row[(k + o) % len] ?? " ");
      }
      flush();
    }
  };

  const frame = (now: number) => {
    raf = 0;
    if (dead) return;
    // Only flowing: every other frame is enough, half the work.
    if (calm && (odd = !odd)) return kick();
    // The time since the last frame drawn, from the frames' own clock alone: set from outside (a
    // pointer's move, later than the frame it is in) it came to nothing, and the flow stood still
    // under a pointer (kumo, 2026-11-25).
    const dt = Math.max(0, Math.min(50, now - last)) / 1000;
    last = now;
    tick = Math.floor(now / 125);
    // The flow gathers and dies away: its speed goes to what is asked of it, by a part each frame.
    // It flows the whole time it is there (kumo, 2026-11-25), slowly; faster for a moment as it
    // comes, as its figure changes, as the effort is moved.
    const burst = now < flowTo;
    const want = still ? 0 : burst ? 1 : IDLE;
    vel += (want - vel) * (1 - Math.exp(-dt / (burst ? 0.4 : 0.7)));
    if (!(vel >= 0 && vel <= 1.5)) vel = want; // never out of what a speed is, whatever a frame's time was
    const flow = vel > 0.004 ? vel : 0;
    if (flow > 0) for (let r = 0; r < rows; r++) off[r] = (((off[r]! + speed[r]! * flow * pace(pw) * dt) % len) + len) % len;
    // The figure's place, size and strength glide to what is asked: the cells read anew each frame.
    const [gx, gs] = goal();
    const [gc, gh] = winGoal();
    const gy = yGoal(gc, gs);
    const gliding = Math.abs(gc - wc) > 0.4 || Math.abs(gh - wh) > 0.4 || Math.abs(gx - px) > 0.4 || Math.abs(gy - py) > 0.4 || Math.abs(gs - ps) > 0.4 || Math.abs(pwT - pw) > 0.004;
    if (gliding) {
      const k = 1 - Math.exp(-dt / 0.3);
      wc += (gc - wc) * k;
      wh += (gh - wh) * k;
      px += (gx - px) * k;
      py += (gy - py) * k;
      ps += (gs - ps) * k;
      pw += (pwT - pw) * k;
    } else if (wasGliding) (wc = gc), (wh = gh), (px = gx), (py = gy), (ps = gs), (pw = pwT);
    if ((gliding || wasGliding) && !leaving) to = read();
    const span = now - t0;
    const turning = span < spreadNow + TURN + 400;
    if (!turning && !leaving && (gliding || wasGliding)) (cur.a.set(to.a), cur.r.set(to.r), cur.g.set(to.g), cur.b.set(to.b));
    wasGliding = gliding;
    if (turning) {
      for (let i = 0; i < cur.a.length; i++) {
        const p = clamp((span - wait[i]!) / TURN);
        const e = p * p * (3 - 2 * p);
        cur.a[i] = from.a[i]! + (to.a[i]! - from.a[i]!) * e;
        cur.r[i] = from.r[i]! + (to.r[i]! - from.r[i]!) * e;
        cur.g[i] = from.g[i]! + (to.g[i]! - from.g[i]!) * e;
        cur.b[i] = from.b[i]! + (to.b[i]! - from.b[i]!) * e;
        // A cell the figure comes to or leaves is other characters on the way, its own again after.
        busy[i] = p > 0 && p < 1 && Math.abs(to.a[i]! - from.a[i]!) > 0.2 ? 1 : 0;
      }
    } else if (wasTurning) {
      busy.fill(0);
      // Gone to the last cell: told, once.
      if (leaving) {
        const done = leaving;
        leaving = null;
        left = true;
        draw();
        return done();
      }
    }
    wasTurning = turning;
    hot = false;
    for (let i = 0; i < heat.length; i++) {
      const h = heat[i]!;
      if (h < 0.02) {
        heat[i] = 0;
        continue;
      }
      hot = true;
      // About the pointer the code is written over with other code, a row's cells from one line.
      if (Math.random() < h * 0.12) {
        const r = (i / cols) | 0, at = ((i % cols) + Math.floor(off[r]!)) % len;
        if (now - overAt[r]! > 600) (over[r] = CODE[(Math.random() * CODE.length) | 0]! + "  "), (overAt[r] = now);
        text[r]![at] = over[r]![at % over[r]!.length]!;
      }
      heat[i] = h * 0.9;
    }
    draw();
    calm = !burst && !turning && !hot && !gliding && Math.abs(vel - want) < 0.02;
    if (flow > 0 || want || turning || hot || gliding) kick();
  };
  const kick = () => {
    if (!raf && !dead) raf = requestAnimationFrame(frame);
  };

  /** Goes over to the figure as painted: at once (snap), or cell by cell from the middle. */
  const turn = (snap: boolean) => {
    to = read();
    if (snap || still) {
      cur = { a: to.a.slice(), r: to.r.slice(), g: to.g.slice(), b: to.b.slice() };
      from = cur;
      t0 = -1e9;
      draw();
      if (!still) kick();
      return;
    }
    from = { a: cur.a.slice(), r: cur.r.slice(), g: cur.g.slice(), b: cur.b.slice() };
    const far = Math.hypot(W / 2, H / 2) || 1;
    for (let i = 0; i < wait.length; i++) wait[i] = (Math.hypot(((i % cols) + 0.5) * cw - px, (((i / cols) | 0) + 0.5) * ROW - py) / far) * SPREAD * (0.92 + Math.random() * 0.16);
    t0 = performance.now();
    spreadNow = SPREAD;
    // Faster for a moment as it first comes; a figure changing leaves the flow as it is.
    if (first) flowTo = t0 + 2600;
    first = false;
    kick();
  };

  const show = (f: Fig | null, snap: boolean) => {
    const n = ++asked;
    void paint(f).then((isPhoto) => {
      if (n !== asked || dead || leaving || left) return;
      photo = isPhoto;
      drawnKey = f?.key ?? "";
      turn(snap);
    });
  };

  /** What is asked, at once (no motion wanted, or nothing drawn yet to move from). */
  const settle = () => {
    [px, ps] = goal();
    [wc, wh] = winGoal();
    py = yGoal(wc, ps);
    pw = pwT;
    if (!cur.a.length || drawnKey !== (fig?.key ?? "")) return;
    to = read();
    cur = { a: to.a.slice(), r: to.r.slice(), g: to.g.slice(), b: to.b.slice() };
    from = cur;
    draw();
  };

  const resize = () => {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h || (w === W && h === H)) return;
    const grown = W > 0;
    const was = grown ? { cols, rows, text, off, speed, cur } : null;
    W = w;
    H = h;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    g.font = `${FONT}px ui-monospace, "SF Mono", Menlo, "JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace`;
    cw = g.measureText("M").width || 5.4;
    [px, ps] = goal();
    [wc, wh] = winGoal();
    py = yGoal(wc, ps);
    pw = pwT;
    cols = Math.ceil(W / cw) + 1;
    rows = Math.floor(H / ROW);
    len = cols * 2 + 40;
    const n = cols * rows;
    cur = field(n);
    for (let i = 0; i < n; i++) (cur.r[i] = ink[0]), (cur.g[i] = ink[1]), (cur.b[i] = ink[2]);
    from = cur;
    wait = new Float32Array(n);
    heat = new Float32Array(n);
    busy = new Uint8Array(n);
    over = new Array<string>(rows).fill("");
    overAt = new Float64Array(rows);
    off = new Float32Array(rows);
    speed = new Float32Array(rows);
    text = [];
    for (let r = 0; r < rows; r++) {
      // Made another size (the page laid out, the window sized): the rows it had go on as they
      // were, each where it was; only new ones are made (kumo, 2026-11-25: all of it was made anew
      // each time, and it jumped about as the page came).
      const old = was && r < was.rows ? was.text[r]! : null;
      text.push(old ? (old.length >= len ? old.slice(0, len) : [...old, ...line(len - old.length)]) : line(len));
      off[r] = old ? was!.off[r]! % len : Math.random() * len;
      speed[r] = old ? was!.speed[r]! : (r % 2 ? -1 : 1) * (1.8 + Math.random() * 4.2); // cells a second
    }
    if (was)
      for (let r = 0; r < Math.min(rows, was.rows); r++)
        for (let k = 0; k < Math.min(cols, was.cols); k++) {
          const i = r * cols + k, j = r * was.cols + k;
          (cur.a[i] = was.cur.a[j]!), (cur.r[i] = was.cur.r[j]!), (cur.g[i] = was.cur.g[j]!), (cur.b[i] = was.cur.b[j]!);
        }
    if (!grown && kept && kept.cols === cols && kept.rows === rows && performance.now() - kept.at < 2000) {
      ({ text, off, speed, cur } = kept);
      from = cur;
      first = false;
      draw();
      const same = kept.key === (fig?.key ?? "");
      kept = null;
      return show(fig, same);
    }
    show(fig, grown);
  };

  return {
    figure(f) {
      if ((f?.key ?? "") === (fig?.key ?? "") && drawnKey === (f?.key ?? "")) return;
      fig = f;
      if (W) show(f, false);
    },
    resize,
    // Going (kumo, 2026-11-25: played whole, not cut): the code flows off and the cells go out
    // from the band's rim inwards, the figure's last; done as the last is out.
    leave(done) {
      if (leaving) return void (leaving = done);
      if (still || !W || left) return done();
      asked++;
      from = { a: cur.a.slice(), r: cur.r.slice(), g: cur.g.slice(), b: cur.b.slice() };
      to = { a: new Float32Array(cur.a.length), r: cur.r.slice(), g: cur.g.slice(), b: cur.b.slice() };
      const far = Math.hypot(Math.max(px, W - px), H / 2) || 1;
      for (let i = 0; i < wait.length; i++) wait[i] = (1 - Math.hypot(((i % cols) + 0.5) * cw - px, (((i / cols) | 0) + 0.5) * ROW - py) / far) * SPREAD * 1.5 * (0.92 + Math.random() * 0.16);
      leaving = done;
      t0 = performance.now();
      spreadNow = SPREAD * 1.5;
      flowTo = t0 + 1500;
      kick();
    },
    /** Asked for again while going, or after: there again, its figure coming as at first. */
    enter() {
      if (!leaving && !left) return;
      leaving = null;
      left = false;
      if (W) show(fig, false);
    },
    power(f) {
      if (Math.abs(f - pwT) < 0.01) return;
      pwT = f;
      if (!W) return void (pw = f);
      if (still) return settle();
      flowTo = performance.now() + 1400;
      kick();
    },
    window(middle, height) {
      if (Math.abs(middle - wcT) < 1 && Math.abs(height - whT) < 1) return;
      const first = wcT < 0;
      wcT = middle;
      whT = height;
      if (!W) return;
      if (still || first || settling()) return settle();
      kick();
    },
    place(x, side, y = -1) {
      if (Math.abs(x - cx) < 1 && Math.abs(side - most) < 1 && Math.abs(y - cy) < 1) return;
      cy = y;
      cx = x;
      most = side;
      if (!W) return;
      if (still || px < 0 || settling()) return settle();
      kick();
    },
    // y -1: none (the figure in the window's middle).
    foot(y) {
      if (Math.abs(y - footT) < 1) return;
      footT = y;
      if (!W) return;
      if (still || px < 0 || settling()) return settle();
      kick();
    },
    // The page's colours changed (day and night): the figure and the code drawn again in the ink
    // now, at once (kumo, 2026-11-25: Ir kept the old one).
    recolor() {
      if (!W || leaving || left) return;
      show(fig, true);
    },
    near(x, y) {
      if (still || !W || x < -NEAR || y < -NEAR || x > W + NEAR || y > H + NEAR) return;
      const c0 = Math.max(0, Math.floor((x - NEAR) / cw)), c1 = Math.min(cols - 1, Math.ceil((x + NEAR) / cw));
      const r0 = Math.max(0, Math.floor((y - NEAR) / ROW)), r1 = Math.min(rows - 1, Math.ceil((y + NEAR) / ROW));
      for (let r = r0; r <= r1; r++)
        for (let k = c0; k <= c1; k++) {
          const d = Math.hypot((k + 0.5) * cw - x, (r + 0.5) * ROW - y);
          if (d < NEAR) heat[r * cols + k] = Math.max(heat[r * cols + k]!, (1 - d / NEAR) ** 1.5);
        }
      kick();
    },
    stop() {
      if (cols && rows && !leaving && !left) kept = { at: performance.now(), cols, rows, text, off, speed, cur, key: drawnKey };
      dead = true;
      cancelAnimationFrame(raf);
    },
  };
}
