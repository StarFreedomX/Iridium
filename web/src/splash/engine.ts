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
function mark(g: CanvasRenderingContext2D, agent: Agent, ink: string, size = SRC): boolean {
  const box = (vb: string) => {
    const [x, y, w, h] = vb.split(" ").map(Number) as [number, number, number, number];
    const k = (size * 0.8) / Math.max(w, h);
    g.translate(size / 2 - (x + w / 2) * k, size / 2 - (y + h / 2) * k);
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

// The rainbow's colours, one for each degree, worked out once: not three numbers made anew for each
// cell each frame.
const HUES = (() => {
  const t = new Uint8Array(360 * 3);
  for (let h = 0; h < 360; h++) t.set(rainbowAt(h).map((v) => Math.min(255, Math.round(v))), h * 3);
  return t;
})();
const hueAt3 = (h: number) => ((((h | 0) % 360) + 360) % 360) * 3;

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

export type Splash = { leave(done: () => void): void; enter(): void; figure(f: Fig | null): void; place(x: number, side: number, y?: number): void; foot(y: number): void; window(middle: number, height: number): void; recolor(): void; power(f: number): void; resize(): void; near(x: number, y: number): void; tap(x: number, y: number): void; hold(on: boolean): void; stop(): void; edge(on: boolean): void; };


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
  let busy = new Uint8Array(0), wasTurning = false;
  let wait = new Float32Array(0), off = new Float32Array(0), speed = new Float32Array(0);
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
  // How far the band is let out above and below what is asked (kumo, 2026-11-25: pressed above
  // or below it, or held there, it opens out slowly, as far as the pane goes).
  let up = 0, down = 0;
  const winGoal = (): [number, number] => {
    const [c, h] = wcT < 0 ? [H / 2, H] : [wcT, whT];
    if (!up && !down) return [c, h];
    const top = Math.max(-H * 0.3, c - h / 2 - up), bot = Math.min(H * 1.3, c + h / 2 + down);
    return [(top + bot) / 2, Math.max(h, bot - top)];
  };
  /** A press or hold at height y, above or below the band's middle: the band let out that way. */
  const outTo = (y: number, by: number) => {
    if (wcT < 0) return;
    if (y < wc - wh * 0.28) up = Math.min(up + by, H * 1.5);
    else if (y > wc + wh * 0.28) down = Math.min(down + by, H * 1.5);
    else return;
    kick();
  };
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
  let t0 = -1e9, flowTo = 0, last = 0, raf = 0, first = true, dead = false;

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
    // Iridium's letters are not shown for now (kumo, 2026-11-25: no channel open, and a channel
    // with no agent, are blank as they come; an agent's face comes out of it as one is added).
    // The cells are all there still, so what a finger lights up is seen: the characters, in their
    // colours.
    if (rainbow) out.a.fill(0);
    return out;
  };

  const FONTS = (z: number) => `${FONT * z}px ui-monospace, "SF Mono", Menlo, "JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace`;
  // What the stars, rings and the rocket light this frame, each cell's most (lit) in its hue (litHue):
  // laid down shape by shape over the cells under their outlines alone, a row at a time (a ring's
  // two spans, a stroke's band), then read as the rows are drawn; the cells lit are kept (touched)
  // to be put back to none, not the whole field gone over (kumo, 2026-11-25: lighter work).
  let lit = new Float32Array(0), litHue = new Float32Array(0), rowLit = new Uint8Array(0), touched = new Int32Array(0), nTouched = 0;
  const light = (r: number, k: number, v: number, h: number) => {
    if (v <= 0.02) return;
    const i = r * cols + k;
    if (v <= lit[i]!) return;
    if (lit[i] === 0) touched[nTouched++] = i;
    lit[i] = v;
    litHue[i] = h;
    rowLit[r] = 1;
  };
  /** Each cell whose middle is in the band from (ax, ay) to (bx, by), w either side of it: told its
   *  middle, how far it is from the stroke and where along it (0 to 1). */
  const stroke = (ax: number, ay: number, bx: number, by: number, w: number, each: (r: number, k: number, x: number, y: number, d: number, u: number) => void) => {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const r0 = Math.max(0, Math.ceil((Math.min(ay, by) - w - 0.5 - ROW / 2) / ROW)), r1 = Math.min(rows - 1, Math.floor((Math.max(ay, by) + w - 0.5 - ROW / 2) / ROW));
    for (let r = r0; r <= r1; r++) {
      const ym = r * ROW + 0.5 + ROW / 2;
      // The part of the stroke within w of this row, up and down: the cells to look at are by it.
      let xa = Math.min(ax, bx), xb = Math.max(ax, bx);
      if (Math.abs(dy) > 1) {
        const ta = clamp((ym - w - ay) / dy), tb = clamp((ym + w - ay) / dy);
        (xa = ax + dx * Math.min(ta, tb)), (xb = ax + dx * Math.max(ta, tb));
        if (xa > xb) [xa, xb] = [xb, xa];
      }
      const f = off[r]! - Math.floor(off[r]!);
      const k0 = Math.max(0, Math.ceil((xa - w) / cw - 0.5 + f)), k1 = Math.min(cols - 1, Math.floor((xb + w) / cw - 0.5 + f));
      for (let k = k0; k <= k1; k++) {
        const xm = (k + 0.5 - f) * cw;
        const u = L2 ? clamp(((xm - ax) * dx + (ym - ay) * dy) / L2) : 0;
        const d = Math.hypot(xm - ax - dx * u, ym - ay - dy * u);
        if (d < w) each(r, k, xm, ym, d, u);
      }
    }
  };
  /** A ring: the cells in it, a row's two spans of it (none of its inside or outside gone over). */
  const ringOf = (q: Shape, now: number) => {
    const o = q.rad + q.w, n = Math.max(0, q.rad - q.w);
    const r0 = Math.max(0, Math.ceil((q.y - o - 0.5 - ROW / 2) / ROW)), r1 = Math.min(rows - 1, Math.floor((q.y + o - 0.5 - ROW / 2) / ROW));
    for (let r = r0; r <= r1; r++) {
      const ym = r * ROW + 0.5 + ROW / 2, dy = ym - q.y;
      const xo = Math.sqrt(Math.max(0, o * o - dy * dy)), xi = Math.abs(dy) < n ? Math.sqrt(n * n - dy * dy) : 0;
      const f = off[r]! - Math.floor(off[r]!);
      for (const [a, b] of [[q.x - xo, q.x - xi], [q.x + xi, q.x + xo]] as const) {
        const k0 = Math.max(0, Math.ceil(a / cw - 0.5 + f)), k1 = Math.min(cols - 1, Math.floor(b / cw - 0.5 + f));
        for (let k = k0; k <= k1; k++) {
          const dx = (k + 0.5 - f) * cw - q.x;
          light(r, k, q.fade * clamp(1 - Math.abs(Math.hypot(dx, dy) - q.rad) / q.w), q.hue + Math.atan2(dy, dx) * 57.3 + now * 0.12);
        }
      }
    }
  };
  /** A star: its ten edges, each a stroke. */
  const starOf = (q: Shape, now: number) => {
    const tip = (j: number): [number, number] => {
      const a = q.turn + (j * Math.PI) / 5 - Math.PI / 2, d = j % 2 ? q.rad * 0.45 : q.rad;
      return [q.x + Math.cos(a) * d, q.y + Math.sin(a) * d];
    };
    for (let j = 0; j < 10; j++) {
      const [ax, ay] = tip(j), [bx, by] = tip(j + 1);
      stroke(ax, ay, bx, by, q.w, (r, k, x, y, d) => light(r, k, q.fade * (1 - d / q.w), q.hue + Math.atan2(y - q.y, x - q.x) * 57.3 + now * 0.12));
    }
  };
  /** The rocket's way: drawn along it as time stands, then its head and the trail behind it. */
  const rocketOf = (rn: RocketNow, now: number) => {
    const { k } = rn, w = ROW * 0.8;
    for (let i = 1; i < k.pts.length; i++) {
      const [ax, ay] = k.pts[i - 1]!, [bx, by] = k.pts[i]!, s0 = k.cum[i - 1]!, L = k.cum[i]! - s0;
      stroke(ax, ay, bx, by, w * 1.7, (r, c, _x, _y, d, u) => {
        const at = s0 + L * u;
        let v = 0;
        if (rn.stop) v = at <= rn.drawn * k.total ? 0.85 * clamp(1 - d / w) : 0;
        else {
          const tail = at > rn.head ? 0.75 : clamp(1 - (rn.head - at) / 240);
          v = tail * clamp(1 - d / (w * (1 + (at <= rn.head ? tail * 0.7 : 0))));
        }
        light(r, c, v, at * 0.9 - now * 0.25);
      });
    }
    if (!rn.stop) stroke(rn.hx, rn.hy, rn.hx, rn.hy, ROW * 2.2, (r, c, _x, _y, d) => light(r, c, 1 - d / (ROW * 2.2), rn.head * 0.9 - now * 0.25));
  };

  // The canvas's left and right tenth go to none (a CSS mask before: done in the canvas, what is
  // drawn in it is whole there).
  let edgeOn = true;
  const edges = (s: number) => {
    if (!edgeOn || s < 0.01) return;
    const w = W * 0.1;
    g.globalCompositeOperation = "destination-out";
    for (const x of [0, W]) {
      const gr = g.createLinearGradient(x, 0, x ? W - w : w, 0);
      gr.addColorStop(0, `rgba(0,0,0,${s})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x ? W - w : 0, 0, w, H);
    }
    g.globalCompositeOperation = "source-over";
  };


  // The ring (kumo, 2026-11-26): where no agent is to be drawn, a Möbius band of the code's own
  // characters in the pane's middle, aslant, turning in itself, the rainbow flowing along it. Laid
  // down each frame as points of the band (RN along it, a few across), each on the cell it falls
  // in, the nearest kept; no cell asked anything. A star over a part of it (draw) stirs that part
  // (stir): another run of colours there, going out along the band both ways and dying away.
  const RN = 512;
  const RC = new Float32Array(RN), RS = new Float32Array(RN);
  for (let j = 0; j < RN; j++) (RC[j] = Math.cos((j / RN) * 6.2832)), (RS[j] = Math.sin((j / RN) * 6.2832));
  let ra = new Float32Array(0), rh = new Float32Array(0), rz = new Float32Array(0), ru = new Int16Array(0), rowRing = new Uint8Array(0), ringCells = new Int32Array(0), nRing = 0;
  let stir = new Float32Array(RN), stir2 = new Float32Array(RN);
  let ringK = 0, ringAt = 0;
  const ringLay = (now: number) => {
    for (let j = 0; j < nRing; j++) ra[ringCells[j]!] = 0;
    nRing = 0;
    rowRing.fill(0);
    const dt = Math.min(50, now - ringAt);
    ringAt = now;
    if (ringK < 0.01 || !rows) return;
    // What is stirred goes on to its neighbours, less each time, and dies away.
    const dec = Math.exp(-dt / 700);
    for (let j = 0; j < RN; j++) stir2[j] = Math.max(stir[j]!, (stir[(j + 1) % RN]! + stir[(j + RN - 1) % RN]!) * 0.494) * dec;
    [stir, stir2] = [stir2, stir];
    const top = footT >= 0 ? footT : H;
    const R = Math.min(W * 0.36, top * 0.3, 230), wv = R * 0.24, xc = W / 2, yc = cy >= 0 ? cy : top * 0.5;
    const t = still ? 0 : now, spin = t * 0.0004, lean = 0.92 + 0.1 * Math.sin(t / 2900);
    const ca = Math.cos(lean), sa = Math.sin(lean), cr = Math.cos(-0.5), sr = Math.sin(-0.5);
    const RM = Math.max(8, Math.ceil((wv * 2) / ROW) + 3), far = R + wv, flow = t * 0.05;
    for (let iu = 0; iu < RN; iu++) {
      const cu = RC[iu]!, su = RS[iu]!, half = (iu / RN) * 3.1416 + spin, ct = Math.cos(half), st = Math.sin(half);
      const e = stir[iu]!, hue0 = (iu / RN) * 360 - flow + e * 150;
      for (let iv = 0; iv < RM; iv++) {
        const vn = (iv / (RM - 1)) * 2 - 1, v = vn * wv, r = R + v * ct;
        const x = r * cu, y = r * su, z = v * st;
        const y2 = y * ca - z * sa, z2 = y * sa + z * ca;
        const k = 1 + z2 / (far * 3.2);
        const row = ((yc + (x * sr + y2 * cr) * k) / ROW) | 0;
        if (row < 0 || row >= rows) continue;
        const col = Math.round((xc + (x * cr - y2 * sr) * k) / cw - 0.5 + off[row]! - Math.floor(off[row]!));
        if (col < 0 || col >= cols) continue;
        const i = row * cols + col;
        if (ra[i]! > 0 && rz[i]! >= z2) continue;
        if (ra[i] === 0) ringCells[nRing++] = i;
        rowRing[row] = 1;
        rz[i] = z2;
        ru[i] = iu;
        // Nearer, stronger; its two edges stronger than its middle.
        ra[i] = Math.min(1, (0.3 + 0.55 * (z2 / far + 1) * 0.5 + 0.25 * vn * vn + e * 0.4) * ringK);
        rh[i] = hue0 + vn * 46;
      }
    }
  };

  const draw = () => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = FONTS(1);
    g.textBaseline = "top";
    const now = performance.now();
    // The rainbow's place now: across the figure, moving on as time goes.
    const shift = still ? 0 : now * 0.06, fx0 = px - ps / 2, span = ps || 1;
    // A face at rest: only the rows and columns about it are drawn, the code beyond its rim being
    // none (kumo, 2026-11-25: the whole pane was gone over each frame for it, and it lagged).
    const rim = photo && !leaving && now - t0 > spreadNow + TURN + 400 ? ps * 0.6 : 0;
    for (let j = 0; j < nTouched; j++) lit[touched[j]!] = 0;
    nTouched = 0;
    rowLit.fill(0);
    ringLay(now);
    for (const q of shapes(now)) (q.ring ? ringOf : starOf)(q, now);
    const rs = rocketNow(now);
    if (rs) rocketOf(rs, now);
    // Time stood still: the rest of the code dimmed for it.
    const dim = rs && rs.stop ? 1 - 0.45 * Math.sin(Math.PI * Math.min(1, (now - rs.k.at) / STOP)) ** 0.5 : 1;
    for (let r = 0; r < rows; r++) {
      const o = Math.floor(off[r]!), f = off[r]! - o, row = text[r]!, y = r * ROW + 0.5, ym = y + ROW / 2;
      const env = seen(ym);
      const rr = rowRing[r] === 1;
      const lr = rowLit[r] === 1 || rr;
      if (!lr && (env < 0.01 && fr[r]! < 0.01)) continue;
      if (!lr && rim && Math.abs(ym - py) > rim) continue;
      const k0 = rim && !lr ? Math.max(0, Math.floor((px - rim) / cw)) : 0;
      const k1 = rim && !lr ? Math.min(cols, Math.ceil((px + rim) / cw) + 1) : cols;
      const hue0 = (ym - py) * 0.4 - shift;
      let run = "", at = 0, key = -1;
      const flush = () => {
        if (!run || !(key & 31)) return;
        g.fillStyle = `rgba(${((key >> 5) & 31) << 3},${((key >> 10) & 31) << 3},${((key >> 15) & 31) << 3},${(key & 31) / 24})`;
        g.fillText(run, (at - f) * cw, y);
      };
      for (let k = k0; k < k1; k++) {
        const i = r * cols + k;
        let cr = cur.r[i]!, cg = cur.g[i]!, cb = cur.b[i]!;
        // A star, ring or the rocket over this cell: the cell's own character in its colour.
        let lv = lr ? lit[i]! : 0;
        const rv = rr ? ra[i]! : 0;
        if (rv > 0) {
          // The ring's cell: in the ring's colour; a star over it stirs the ring there, and is not
          // drawn over it.
          if (lv > 0.3) stir[ru[i]!] = 1;
          lv = 0;
          const h3 = hueAt3(rh[i]!);
          (cr = HUES[h3]!), (cg = HUES[h3 + 1]!), (cb = HUES[h3 + 2]!);
        }
        const fmi = rainbow ? (fm[i] ?? 0) : 0;
        if (fmi > 0) {
          const h3 = hueAt3((((k + 0.5 - f) * cw - fx0) / span) * 300 + hue0);
          (cr += (HUES[h3]! - cr) * fmi), (cg += (HUES[h3 + 1]! - cg) * fmi), (cb += (HUES[h3 + 2]! - cb) * fmi);
        }
        if (lv > 0) {
          const h3 = hueAt3(litHue[i]!), m = Math.min(1, lv * 1.4);
          (cr += (HUES[h3]! - cr) * m), (cg += (HUES[h3 + 1]! - cg) * m), (cb += (HUES[h3 + 2]! - cb) * m);
        }
        const k2 = Math.min(24, Math.round(Math.max(clamp(cur.a[i]!) * (env + (1 - env) * (fm[i] ?? 0)) * dim, lv * 0.95, rv) * 24)) | ((cr >> 3) << 5) | ((cg >> 3) << 10) | ((cb >> 3) << 15);
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
    edges(1);
  };

  // What the pointer leaves (kumo, 2026-11-25): stars and rings, growing out from a point, drawn
  // in no character of their own: the code's rows go on as they are, and those of their characters
  // a shape's outline lies over are in the rainbow (kumo: not a new character put in).
  type Spark = { x: number; y: number; vx: number; vy: number; at: number; life: number; ring: boolean; size: number; hue: number; spin: number };
  type Shape = { x: number; y: number; rad: number; turn: number; ring: boolean; fade: number; hue: number; w: number };
  let pops: Spark[] = [];
  // The second ring of a press, on its way.
  let lx = 0, ly = 0, lensOn = false, lastPop = 0;
  const pop = (x: number, y: number, ring: boolean, speed: number, size: number) => {
    const a = Math.random() * Math.PI * 2;
    pops.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - (ring ? 0 : 10), at: performance.now(), life: ring ? 1100 + Math.random() * 500 : 900 + Math.random() * 500, ring, size, hue: Math.random() * 360, spin: (Math.random() - 0.5) * 1.5 });
    if (pops.length > 30) pops = pops.slice(-30);
  };
  /** The shapes now: where each is, how far out it has grown, how much of it is left. */
  const shapes = (now: number): Shape[] => {
    if (!pops.length) return [];
    pops = pops.filter((p) => now - p.at < p.life);
    return pops.map((p) => {
      const t = (now - p.at) / p.life, s2 = (now - p.at) / 1000;
      // Out from a point to its size, fast at first, slowing; going in its last part.
      const rad = Math.max(cw, p.size * (1 - (1 - t) ** 3)), w = ROW * 0.8;
      return { x: p.x + p.vx * s2, y: p.y + p.vy * s2, rad, turn: p.spin * s2, ring: p.ring, fade: t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45, hue: p.hue, w };
    });
  };
  // A zigzag drawn with the pointer (kumo, 2026-11-25): time stands still (the flow and the stars
  // stop, the rest of the code dims) as the line drawn lights up along the code, then a rocket
  // goes along it, faster and faster, its trail behind it, and bursts at its end.
  type Rocket = { pts: [number, number][]; cum: number[]; total: number; at: number; flown: boolean; puff: number };
  type RocketNow = { k: Rocket; stop: boolean; drawn: number; head: number; hx: number; hy: number };
  // No standing still before it goes (kumo, 2026-11-26: the page seemed stuck).
  const STOP = 0, FLY = 850;
  let rk: Rocket | null = null;
  let path: { x: number; y: number; t: number }[] = [];
  let looked = 0, held = false, heldAt = 0, lastHeld = 0;
  /** The pointer's way, its corners only (Ramer–Douglas–Peucker, eps px). */
  const corners = (pts: { x: number; y: number }[], eps: number): [number, number][] => {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const go = (a: number, b: number) => {
      const A = pts[a]!, B = pts[b]!, L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      let far = 0, at = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((B.x - A.x) * (A.y - pts[i]!.y) - (A.x - pts[i]!.x) * (B.y - A.y)) / L;
        if (d > far) (far = d), (at = i);
      }
      if (far > eps && at > 0) (keep[at] = 1), go(a, at), go(at, b);
    };
    go(0, pts.length - 1);
    return pts.filter((_, i) => keep[i]).map((p) => [p.x, p.y]);
  };
  /** A zigzag in the pointer's way: two sharp turns or more, between strokes long enough. */
  const zigzag = (): [number, number][] | null => {
    if (path.length < 8) return null;
    const v = corners(path, 14);
    if (v.length < 4 || v.length > 9) return null;
    let sharp = 0, total = 0;
    for (let i = 1; i < v.length; i++) {
      const L = Math.hypot(v[i]![0] - v[i - 1]![0], v[i]![1] - v[i - 1]![1]);
      total += L;
      if (L < 50) return null;
      if (i < v.length - 1) {
        const ax = v[i]![0] - v[i - 1]![0], ay = v[i]![1] - v[i - 1]![1], bx = v[i + 1]![0] - v[i]![0], by = v[i + 1]![1] - v[i]![1];
        if ((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1) < -0.2) sharp++;
      }
    }
    return sharp >= 2 && total > 260 ? v : null;
  };
  const launch = (pts: [number, number][]) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    rk = { pts, cum, total: cum.at(-1)!, at: performance.now(), flown: false, puff: 0 };
    path = [];
    kick();
  };
  /** The point s along the rocket's way. */
  const along = (k: Rocket, s: number): [number, number] => {
    let i = 1;
    while (i < k.cum.length - 1 && k.cum[i]! < s) i++;
    const a = k.pts[i - 1]!, b = k.pts[i]!, L = k.cum[i]! - k.cum[i - 1]! || 1, u = clamp((s - k.cum[i - 1]!) / L);
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
  const rocketNow = (now: number): RocketNow | null => {
    if (!rk) return null;
    const t = now - rk.at;
    const stop = t < STOP;
    const drawn = STOP ? clamp(t / (STOP * 0.7)) : 1;
    const u = clamp((t - STOP) / FLY);
    const head = stop ? -1 : rk.total * u * u;
    const [hx, hy] = head < 0 ? [-1e9, -1e9] : along(rk, head);
    return { k: rk, stop, drawn: drawn * (2 - drawn), head, hx, hy };
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
    const frozen = !!rk && now - rk.at < STOP;
    if (frozen) for (const p of pops) p.at += dt * 1000;
    if (rk && !frozen) {
      const t = now - rk.at;
      if (!rk.flown) (rk.flown = true), (flowTo = now + 1100);
      if (t < STOP + FLY && now - rk.puff > 60) {
        rk.puff = now;
        const u = (t - STOP) / FLY, [hx, hy] = along(rk, rk.total * u * u);
        pop(hx, hy, false, 25, 14 + Math.random() * 10);
      }
      if (t >= STOP + FLY) {
        const [ex, ey] = rk.pts.at(-1)!;
        rk = null;
        for (let j = 0; j < 7; j++) pop(ex, ey, false, 150 + Math.random() * 180, 36 + Math.random() * 24);
      }
    }
    // Held down (kumo, 2026-11-25): more of them all the while, and the band let out that way.
    if (held && lensOn && now - heldAt > 280) {
      if (now - lastHeld > 130) {
        lastHeld = now;
        for (let j = 0; j < 2; j++) pop(lx, ly, false, 90 + Math.random() * 130, 28 + Math.random() * 18);
      }
      outTo(ly, 220 * dt);
    }
    if (flow > 0 && !frozen) for (let r = 0; r < rows; r++) off[r] = (((off[r]! + speed[r]! * flow * pace(pw) * dt) % len) + len) % len;
    // The figure's place, size and strength glide to what is asked: the cells read anew each frame.
    const [gx, gs] = goal();
    const [gc, gh] = winGoal();
    const gy = yGoal(gc, gs);
    const gliding = Math.abs(gc - wc) > 0.4 || Math.abs(gh - wh) > 0.4 || Math.abs(gx - px) > 0.4 || Math.abs(gy - py) > 0.4 || Math.abs(gs - ps) > 0.4 || Math.abs(pwT - pw) > 0.004;
    if (gliding) {
      const k = 1 - Math.exp(-dt / 0.3), kw = up || down ? 1 - Math.exp(-dt / 0.9) : k;
      wc += (gc - wc) * kw;
      wh += (gh - wh) * kw;
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
    // The ring there where Iridium's letters would be (no agent to draw), coming and going.
    const ringOn = rainbow && !leaving && !left ? 1 : 0;
    ringK += (ringOn - ringK) * (1 - Math.exp(-dt / 0.35));
    if (Math.abs(ringOn - ringK) < 0.005) ringK = ringOn;
    draw();
    calm = ringK < 0.01 && !burst && !turning && !gliding && !pops.length && !lensOn && !rk && !held && Math.abs(vel - want) < 0.02;
    if (flow > 0 || want || turning || gliding || pops.length || rk || held) kick();
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
    lit = new Float32Array(n);
    litHue = new Float32Array(n);
    touched = new Int32Array(n);
    nTouched = 0;
    rowLit = new Uint8Array(rows);
    ra = new Float32Array(n);
    rh = new Float32Array(n);
    rz = new Float32Array(n);
    ru = new Int16Array(n);
    ringCells = new Int32Array(n);
    nRing = 0;
    rowRing = new Uint8Array(rows);
    busy = new Uint8Array(n);
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
      if (still || !W) return;
      const inside = x >= 0 && y >= 0 && x <= W && y <= H;
      if (!inside) {
        if (lensOn) (lensOn = false), kick();
        return;
      }
      const moved = Math.hypot(x - lx, y - ly);
      lx = x;
      ly = y;
      lensOn = true;
      const now = performance.now();
      // A line is drawn pressed (a mouse's button down, a finger on the pane), not by a pointer
      // only passing (kumo, 2026-11-26: rockets went off unasked).
      if (moved > 3 && held) path.push({ x, y, t: now });
      path = path.filter((p) => now - p.t < 1400);
      if (!rk && now - looked > 60) {
        looked = now;
        const z = zigzag();
        if (z) launch(z);
      }
      if (moved > 6 && now - lastPop > 140) {
        lastPop = now;
        pop(x, y, false, 10 + Math.random() * 20, 30 + Math.random() * 22);
      }
      kick();
    },
    tap(x, y) {
      if (still || !W) return;
      (lx = x), (ly = y), (lensOn = true);
      outTo(y, 90);
      // Stars alone (kumo, 2026-11-26: no rings).
      for (let j = 0; j < 5; j++) pop(x, y, false, 120 + Math.random() * 140, 36 + Math.random() * 20);
      kick();
    },
    hold(on) {
      held = on && !still;
      path = [];
      heldAt = performance.now();
      if (held) kick();
    },
    edge(on) {
      if (on === edgeOn) return;
      edgeOn = on;
      if (W && still) draw();
      kick();
    },
    stop() {
      if (cols && rows && !leaving && !left) kept = { at: performance.now(), cols, rows, text, off, speed, cur, key: drawnKey };
      dead = true;
      cancelAnimationFrame(raf);
    },
  };
}
