// The splash's game (kumo, 2026-11-25): the heart at the pane's upper right pressed, the code
// fills the pane and Iridium's letters go over to a cat-eared boss at its upper left. Nothing in
// it is a character of its own: the code's rows flow on as they are and everything (the boss,
// its subagents, what they send, the bars, the numbers) is the colour of the cells under it.
//
// Light work each frame (kumo: a phone's JS): every shape is laid down a row at a time as spans
// of cells (a ring's two, a line's one, a sprite's rows), no cell asked how far it is from
// anything; one number a cell (its colour and strength, 18 bits), drawn as runs of one colour.
import type { Agent } from "../api/types.gen";

/** The cells as the engine has them this frame. f: each row's flow, the part of a cell it is
 *  along; ov: each cell's colour (0: none); lo, hi: the cells of a row that have one. */
export type Grid = { W: number; H: number; cw: number; row: number; cols: number; rows: number; f: Float32Array; ov: Uint32Array; lo: Int16Array; hi: Int16Array };
export type Cast = { src?: string; agent?: Agent };
export type Hint = "" | "move" | "hold" | "zig";
export type Call = "" | "stream" | "echo" | "parallel" | "think" | "sub" | "flow" | "compact";
export type Out = {
  say(hint: Hint, call: Call): void;
  over(): void;
  shake(px: number): void;
  /** One of the cast on a square of size: true, a picture (its tones kept). */
  face(c: CanvasRenderingContext2D, size: number, who: Cast): Promise<boolean>;
};

/** A cell's colour: its strength (1 to 7) and five bits of each of red, green, blue. */
export const key = (r: number, g: number, b: number, a = 7) => a | ((r >> 3) << 3) | ((g >> 3) << 8) | ((b >> 3) << 13);
const dim = (k: number, a: number) => (k & ~7) | a;
const hsh = (i: number) => Math.imul(i ^ 0x9e3779b1, 0x85ebca6b) >>> 0;
const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);

/** The rainbow, 64 colours round, each strength of it. */
const RB: Uint32Array[] = [];
for (let a = 0; a <= 7; a++) {
  const t = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    const f = (n: number) => {
      const k = (n + (i * 360) / 64 / 30) % 12;
      return 255 * (0.55 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    t[i] = key(f(0), f(8), f(4), a);
  }
  RB.push(t);
}

// Digits and signs, three cells by five, a bit a cell from the upper left.
const FONT: Record<string, number> = { "0": 0x7b6f, "1": 0x2c97, "2": 0x73e7, "3": 0x73cf, "4": 0x5bc9, "5": 0x79cf, "6": 0x79ef, "7": 0x7249, "8": 0x7bef, "9": 0x7bcf, "-": 0x01c0, "+": 0x05d0 };
const HEART = [".XXX.XXX.", "XXXXXXXXX", ".XXXXXXX.", "..XXXXX..", "....X...."];
const SHIELD = ["XXXXXXXXX", "XXXXXXXXX", ".XXXXXXX.", "...XXX..."];
const BOT = [".XXXXXXX.", "XX.XXX.XX", "XXXXXXXXX", "XX.....XX", ".XXXXXXX."];
const R_PATH = "M32 28h5.6v3.2c1.4-2.4 3.6-3.6 6.4-3.6v5.8c-3.8 0-6.2 1.6-6.2 6V46H32z";

type Sprite = { w: number; h: number; k: Uint32Array; n: Uint8Array; e: Uint8Array | null };
const sprite = (w: number, h: number): Sprite => {
  const n = new Uint8Array(w * h);
  for (let j = 0; j < n.length; j++) n[j] = hsh(j + w) & 255;
  return { w, h, k: new Uint32Array(w * h), n, e: null };
};
const bitmap = (rows: string[], k: number): Sprite => {
  const s = sprite(rows[0]!.length, rows.length);
  rows.forEach((line, y) => [...line].forEach((ch, x) => ch === "X" && (s.k[y * s.w + x] = k)));
  return s;
};

// What can be hit: the boss and its subagents.
type Foe = { x: number; y: number; r: number; hp: number; max: number; acc: number; accAt: number; flash: number; bit: number };
type Minion = Foe & { tx: number; ty: number; sp: number; next: number; born: number; dead: number };
type Shot = { x: number; y: number; vx: number; vy: number; t: number; life: number; max: number; star: boolean; hit: number; turn: number; spin: number; was: number };
type Orb = { x: number; y: number; vx: number; vy: number };
type Wave = { rad: number; gx: number; gy: number; gc: number; hit: boolean };
type Beam = { ax: number; ay: number; dx: number; dy: number; t: number; hit: boolean };
type Node = { x: number; y: number; at: number; hit: boolean };
type Fx = { x: number; y: number; t: number; life: number; max: number; hue: number };
type Float = { x: number; y: number; t: number; s: string; k: number };
type Rocket = { pts: [number, number][]; cum: number[]; total: number; t: number; hit: number };

const STOP = 620, FLY = 780; // ms: time stood still as the line is drawn, then the rocket's flight
const WARN = 760, LIVE = 240; // a beam: shown thin, then struck
const DMG = { orb: 7, wave: 10, beam: 12, node: 14, wall: 5, ring: 9, star: 22, pass: 45, blast: 110 };

export function game(G: Grid, out: Out, words: { win: string; lose: string }) {
  const big = document.createElement("canvas"), bg = big.getContext("2d")!;
  const sm = document.createElement("canvas"), sg = sm.getContext("2d", { willReadFrequently: true })!;

  let on = false, dark = false, built = "";
  let T = 0, E = 0, freeze = 0; // ms: the game's clock; the foes' (it stands as time is stopped)
  let mode = 0, modeAt = 0; // 0 coming, 1 the fight, 2 won, 3 lost
  let top = 52, bottom = 400, u = 1, S = 160;
  let bx = 0, by = 0, fx0 = 0, fy0 = 0, fs = 0; // the boss's middle; where the letters were
  let hint: Hint = "", call: Call = "", callAt = 0;
  let moved = 0, heldFor = 0, zigged = false;

  // The colours, by the page's tone.
  let ORANGE: Uint32Array[] = [], PURPLE: Uint32Array[] = [], RED: Uint32Array[] = [];
  let WHITE = 0, FLASH = 0, HP = 0, HPLOW = 0, DEF = 0, GHOST = 0, WALL = 0, EDGE = 0, GREEN = 0, HURT = 0, TAIL = 0;
  const pal = (cs: [number, number, number][]) => [7, 5, 3].map((a) => Uint32Array.from(cs, (c) => key(c[0], c[1], c[2], a)));
  let boss: Sprite = sprite(1, 1), soul: Sprite = sprite(1, 1), shield: Sprite = sprite(1, 1), bot: Sprite = sprite(1, 1);
  let banner: Sprite | null = null, bannerOf = "";
  let cast: Cast[] = [], faces: Sprite[] = [];

  const P = { x: 0, y: 0, hp: 100, shown: 100, inv: 0, hold: false, def: 1, next: 0, wall: 0 };
  const B: Foe & { phase: number; next: number; last: Call; compactAt: number } = { x: 0, y: 0, r: 1, hp: 800, max: 800, acc: 0, accAt: 0, flash: 0, bit: 1, phase: 1, next: 0, last: "", compactAt: 0 };
  let minions: Minion[] = [], shots: Shot[] = [], orbs: Orb[] = [], waves: Wave[] = [], beams: Beam[] = [], nodes: Node[] = [], fxs: Fx[] = [], floats: Float[] = [];
  let later: { at: number; fn: () => void }[] = [];
  let wall: { t: number; cx: number; half: number } | null = null, wallL = 0, wallR = 0;
  let rocket: Rocket | null = null, rocketOk = 0, born = 0;

  // ——— Laying colour on the cells ———

  /** The cells of row r whose middles are from x0 to x1. */
  const span = (r: number, x0: number, x1: number, k: number) => {
    if (r < 0 || r >= G.rows) return;
    const f = G.f[r]!, cw = G.cw;
    let k0 = Math.ceil(x0 / cw - 0.5 + f), k1 = Math.floor(x1 / cw - 0.5 + f);
    if (k0 < 0) k0 = 0;
    if (k1 >= G.cols) k1 = G.cols - 1;
    if (k0 > k1) return;
    if (k0 < G.lo[r]!) G.lo[r] = k0;
    if (k1 > G.hi[r]!) G.hi[r] = k1;
    const a = k & 7, ov = G.ov, e = r * G.cols + k1;
    for (let i = r * G.cols + k0; i <= e; i++) if (a >= (ov[i]! & 7)) ov[i] = k;
  };
  /** The one cell at (x, y), and the next n - 1 after it. */
  const dot = (x: number, y: number, k: number, n = 1) => span((y / G.row) | 0, x - G.cw * 0.5, x + G.cw * (n - 0.5) - 0.01, k);
  const disc = (x: number, y: number, rad: number, k: number) => {
    const ROW = G.row, R = Math.max(rad, ROW * 0.6), r0 = Math.max(0, ((y - R) / ROW) | 0), r1 = Math.min(G.rows - 1, ((y + R) / ROW) | 0);
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * ROW - y, h2 = R * R - dy * dy;
      if (h2 > 0) span(r, x - Math.max(G.cw * 0.6, Math.sqrt(h2)), x + Math.max(G.cw * 0.6, Math.sqrt(h2)), k);
    }
  };
  /** A ring, w either side of rad: a row's two spans of it. A gap in it about the direction
   *  (gx, gy), as wide as gc (a cosine) says. */
  const ring = (x: number, y: number, rad: number, w: number, p: Uint32Array, ph: number, gx = 0, gy = 0, gc = 2) => {
    const ROW = G.row, o = rad + w, n = Math.max(0, rad - w), r0 = Math.max(0, ((y - o) / ROW) | 0), r1 = Math.min(G.rows - 1, ((y + o) / ROW) | 0), m = p.length;
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * ROW - y;
      if (dy >= o || -dy >= o) continue;
      const xo = Math.sqrt(o * o - dy * dy), xi = dy < n && -dy < n ? Math.sqrt(n * n - dy * dy) : 0, k = p[(r + ph) % m]!;
      if (xi === 0 && gc >= 2) {
        span(r, x - xo, x + xo, k);
        continue;
      }
      const mid = (xo + xi) / 2;
      if (gc >= 2 || (-mid * gx + dy * gy) / rad < gc) span(r, x - xo, x - xi, k);
      if (gc >= 2 || (mid * gx + dy * gy) / rad < gc) span(r, x + xi, x + xo, k);
    }
  };
  /** A line, w to its left and right: each row's part of it. */
  const line = (ax: number, ay: number, bx_: number, by_: number, w: number, k: number) => {
    if (ay > by_) [ax, ay, bx_, by_] = [bx_, by_, ax, ay];
    const ROW = G.row, dy = by_ - ay, dx = bx_ - ax;
    w = Math.max(w, G.cw * 0.55);
    const r0 = Math.max(0, (ay / ROW) | 0), r1 = Math.min(G.rows - 1, (by_ / ROW) | 0);
    for (let r = r0; r <= r1; r++) {
      if (dy < 0.5) {
        span(r, Math.min(ax, bx_) - w, Math.max(ax, bx_) + w, k);
        continue;
      }
      const ta = clamp((r * ROW - ay) / dy), tb = clamp(((r + 1) * ROW - ay) / dy);
      const xa = ax + dx * ta, xb = ax + dx * tb;
      span(r, (xa < xb ? xa : xb) - w, (xa < xb ? xb : xa) + w, k);
    }
  };
  const star = (x: number, y: number, rad: number, turn: number, p: Uint32Array) => {
    let px = 0, py = 0;
    for (let j = 0; j <= 10; j++) {
      const a = turn + j * 0.6283 - 1.5708, d = j & 1 ? rad * 0.45 : rad, qx = x + Math.cos(a) * d, qy = y + Math.sin(a) * d;
      if (j) line(px, py, qx, qy, G.cw * 0.8, p[j % p.length]!);
      (px = qx), (py = qy);
    }
  };
  /** A sprite, its upper left at (x, y). show under 1: so much of it, cell by cell; over: all
   *  of it in that colour; eye: its eyes' colour (0: as the rest), by the cell's place. */
  const stamp = (s: Sprite, x: number, y: number, show = 1, over = 0, eye = 0, hue = 0) => {
    const r0 = Math.round(y / G.row), cols = G.cols, ov = G.ov, lim = show * 255;
    for (let sr = 0; sr < s.h; sr++) {
      const r = r0 + sr;
      if (r < 0 || r >= G.rows) continue;
      const k0 = Math.floor(x / G.cw + G.f[r]! + 0.5);
      let lo = cols, hi = -1;
      for (let sc = 0; sc < s.w; sc++) {
        const j = sr * s.w + sc, k = k0 + sc;
        let c = s.k[j]!;
        if (s.e && s.e[j]) c = eye === 1 ? RB[7]![(sc * 2 + sr + hue) & 63]! : eye;
        if (!c || k < 0 || k >= cols || (show < 1 && s.n[j]! >= lim)) continue;
        if (over) c = over;
        const i = r * cols + k;
        if ((c & 7) >= (ov[i]! & 7)) ov[i] = c;
        if (k < lo) lo = k;
        if (k > hi) hi = k;
      }
      if (hi >= 0) {
        if (lo < G.lo[r]!) G.lo[r] = lo;
        if (hi > G.hi[r]!) G.hi[r] = hi;
      }
    }
  };
  /** A number in cells, a point two cells wide: its middle at x, its top at y. */
  const digits = (s: string, x: number, y: number, k: number) => {
    const cw = G.cw, r0 = (y / G.row) | 0;
    let at = x - s.length * 4 * cw + cw;
    for (const ch of s) {
      const bits = FONT[ch] ?? 0;
      for (let b = 0; b < 15; b++) if (bits & (1 << (14 - b))) span(r0 + ((b / 3) | 0), at + (b % 3) * 2 * cw - cw * 0.5, at + (b % 3) * 2 * cw + cw * 1.4, k);
      at += 8 * cw;
    }
  };
  const bar = (x0: number, x1: number, y: number, rows: number, k: number) => {
    const r0 = (y / G.row) | 0;
    for (let r = r0; r < r0 + rows; r++) span(r, x0, x1, k);
  };

  // ——— What is drawn once: the sprites ———

  const raster = (w: number, h: number, draw: (c: CanvasRenderingContext2D, W4: number, H4: number) => void) => {
    big.width = w * 4;
    big.height = h * 4;
    draw(bg, w * 4, h * 4);
    sm.width = w;
    sm.height = h;
    sg.imageSmoothingQuality = "high";
    sg.drawImage(big, 0, 0, w, h);
    return sg.getImageData(0, 0, w, h).data;
  };
  /** The boss: a cat's head, eared, tufted, striped; its eyes Iridium's two letters. */
  const cat = (c: CanvasRenderingContext2D, W4: number, H4: number, eyes: boolean) => {
    c.setTransform(W4 / 112, 0, 0, H4 / 100, (6 * W4) / 112, 0);
    const tri = (...p: number[]) => {
      c.beginPath();
      c.moveTo(p[0]!, p[1]!);
      c.lineTo(p[2]!, p[3]!);
      c.lineTo(p[4]!, p[5]!);
      c.fill();
    };
    if (eyes) {
      c.fillStyle = "#fff";
      c.fillRect(26, 47, 9, 25);
      c.translate(59 - 32 * 1.4, 47 - 28 * 1.4);
      c.scale(1.4, 1.4);
      c.fill(new Path2D(R_PATH));
      return;
    }
    const body = c.createLinearGradient(0, 0, 0, 100);
    body.addColorStop(0, dark ? "#b9a2ff" : "#7a4dff");
    body.addColorStop(1, dark ? "#8274ff" : "#3d2fd0");
    c.fillStyle = body;
    tri(12, 46, 18, 1, 47, 24);
    tri(88, 46, 82, 1, 53, 24);
    c.beginPath();
    c.ellipse(50, 60, 43, 35, 0, 0, 7);
    c.fill();
    tri(8, 62, -5, 78, 16, 80);
    tri(92, 62, 105, 78, 84, 80);
    c.fillStyle = dark ? "#ff8fc4" : "#ff4f9a";
    tri(20, 36, 22, 11, 39, 26);
    tri(80, 36, 78, 11, 61, 26);
    tri(45, 77, 55, 77, 50, 83);
    c.fillStyle = dark ? "#3b2a9a" : "#24177a";
    c.fillRect(46.5, 27, 7, 13);
    c.fillRect(35, 30, 5.5, 9);
    c.fillRect(59.5, 30, 5.5, 9);
  };
  const build = () => {
    const sig = `${dark}|${S | 0}|${G.cw}`;
    if (sig === built) return;
    built = sig;
    ORANGE = pal([[255, 138, 0], [255, 170, 50], [255, 120, 0], [255, 190, 80]]);
    PURPLE = pal([[160, 80, 255], [185, 115, 255], [140, 60, 245], [205, 150, 255]]);
    RED = pal([[255, 55, 95], [255, 100, 60], [255, 45, 140], [255, 80, 80]]);
    WHITE = dark ? key(255, 255, 255) : key(20, 20, 30);
    FLASH = dark ? key(255, 255, 255) : key(255, 60, 90);
    HP = key(255, 59, 92);
    HPLOW = key(255, 149, 0);
    DEF = key(40, 150, 255);
    GHOST = dark ? key(255, 255, 255, 5) : key(60, 60, 70, 5);
    WALL = dark ? key(90, 200, 220, 2) : key(0, 110, 140, 2);
    EDGE = key(0, 200, 230);
    GREEN = key(40, 200, 110);
    HURT = key(255, 45, 70);
    TAIL = dark ? key(150, 125, 255, 6) : key(95, 65, 235, 6);
    soul = bitmap(HEART, HP);
    shield = bitmap(SHIELD, DEF);
    bot = bitmap(BOT, PURPLE[0]![0]!);
    const w = Math.max(14, Math.round(S / G.cw)), h = Math.max(9, Math.round(S / G.row));
    boss = sprite(w, h);
    const d = raster(w, h, (c, a, b) => cat(c, a, b, false));
    for (let j = 0; j < w * h; j++) if (d[j * 4 + 3]! > 105) boss.k[j] = key(d[j * 4]!, d[j * 4 + 1]!, d[j * 4 + 2]!, 7);
    const e = raster(w, h, (c, a, b) => cat(c, a, b, true));
    boss.e = new Uint8Array(w * h);
    for (let j = 0; j < w * h; j++) if (e[j * 4 + 3]! > 70) (boss.e[j] = 1), (boss.k[j] = boss.k[j] || 1);
    banner = null;
    bannerOf = "";
    faces = [];
    void recast();
  };
  /** The cast's faces as sprites, each as its picture comes. */
  const recast = async () => {
    const sig = built, size = clamp(S * 0.36, 44, 72), w = Math.max(9, Math.round(size / G.cw)), h = Math.max(5, Math.round(size / G.row));
    const c = document.createElement("canvas"), cg = c.getContext("2d")!;
    c.width = c.height = 96;
    for (const who of cast) {
      let photo = false;
      try {
        photo = await out.face(cg, 96, who);
      } catch {
        continue;
      }
      if (sig !== built) return;
      let d: Uint8ClampedArray;
      try {
        d = raster(w, h, (b, a, bb) => b.drawImage(c, 0, 0, a, bb));
      } catch {
        continue; // a picture not ours to read
      }
      const s = sprite(w, h);
      let n = 0;
      for (let j = 0; j < w * h; j++) {
        if (d[j * 4 + 3]! < 110) continue;
        const r = d[j * 4]!, g = d[j * 4 + 1]!, b = d[j * 4 + 2]!, lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
        s.k[j] = key(r, g, b, photo ? 4 + Math.round(3 * (dark ? lum : 1 - lum)) : 7);
        n++;
      }
      // A mark stands on a faint round ground: a thing to be hit, not a few strokes.
      if (!photo) for (let j = 0; j < w * h; j++) if (!s.k[j] && (((j % w) + 0.5) / w - 0.5) ** 2 + ((((j / w) | 0) + 0.5) / h - 0.5) ** 2 < 0.24) s.k[j] = dim(PURPLE[0]![0]!, 3);
      if (n > 8) faces.push(s);
    }
  };
  /** Words as a sprite, a mask: as tall as the pane has room for. */
  const say = (text: string) => {
    if (bannerOf === text && banner) return banner;
    const tall = clamp(Math.min((G.W * 0.8) / Math.max(1, text.length), (bottom - top) * 0.3), 60, 200);
    bg.setTransform(1, 0, 0, 1, 0, 0);
    bg.font = `900 ${tall}px system-ui, "PingFang SC", "Noto Sans SC", sans-serif`;
    const wide = bg.measureText(text).width + tall * 0.1;
    const w = Math.max(4, Math.ceil(wide / G.cw)), h = Math.max(4, Math.ceil((tall * 1.15) / G.row));
    const d = raster(w, h, (c) => {
      c.setTransform(4 / G.cw, 0, 0, 4 / G.row, 0, 0);
      c.font = `900 ${tall}px system-ui, "PingFang SC", "Noto Sans SC", sans-serif`;
      c.textBaseline = "middle";
      c.textAlign = "center";
      c.fillStyle = "#fff";
      c.fillText(text, (w * G.cw) / 2, (h * G.row) / 2);
    });
    const s = sprite(w, h);
    s.e = new Uint8Array(w * h);
    for (let j = 0; j < w * h; j++) if (d[j * 4 + 3]! > 95) (s.k[j] = 1), (s.e[j] = 1);
    bannerOf = text;
    return (banner = s);
  };

  // ——— The pane ———

  const layout = () => {
    const tall = bottom - top;
    u = clamp(Math.min(G.W, tall) / 560, 0.62, 1.15);
    S = clamp(Math.min(G.W * 0.4, tall * 0.3), 96, 230);
    bx = 10 + S / 2;
    by = top + 6 + S / 2;
    B.r = S * 0.42;
    build();
  };
  const hudX = () => G.W - 12 - 9 * G.cw;
  const hudY = () => top + 10;

  // ——— The fight ———

  const tell = (h: Hint, c: Call) => {
    if (h === hint && c === call) return;
    hint = h;
    call = c;
    out.say(h, c);
  };
  const float = (x: number, y: number, s: string, k: number) => {
    floats.push({ x, y, t: T, s, k });
    if (floats.length > 14) floats.shift();
  };
  const fx = (x: number, y: number, max: number, life: number, hue = (Math.random() * 64) | 0) => {
    fxs.push({ x, y, t: T, life, max, hue });
    if (fxs.length > 16) fxs.shift();
  };
  const hurt = (e: Foe, n: number) => {
    if (e.hp <= 0) return;
    e.hp -= n;
    e.acc += n;
    e.flash = T + 90;
  };
  /** The soul struck: less by its defence, a third of it while it attacks. */
  const strike = (raw: number) => {
    if (T < P.inv || mode !== 1) return;
    const n = Math.max(1, Math.round(raw * (1 - (P.hold ? 0.23 : 0.7))));
    P.hp = Math.max(0, P.hp - n);
    P.inv = T + 700;
    float(P.x, P.y - 34, `-${n}`, HURT);
    out.shake(5);
    if (P.hp <= 0) end(3);
  };
  const heal = (n: number) => {
    if (P.hp >= 100) return;
    P.hp = Math.min(100, P.hp + n);
    float(P.x, P.y - 34, `+${n}`, GREEN);
  };
  const end = (m: number) => {
    mode = m;
    modeAt = T;
    orbs = [];
    waves = [];
    beams = [];
    nodes = [];
    later = [];
    wall = null;
    rocket = null;
    freeze = 0;
    for (const q of minions) if (!q.dead) q.dead = E;
    if (m === 2) out.shake(8);
    tell("", "");
  };
  const after = (ms: number, fn: () => void) => later.push({ at: E + ms, fn });
  const orb = (x: number, y: number, a: number, v: number) => orbs.length < 90 && orbs.push({ x, y, vx: Math.cos(a) * v * u, vy: Math.sin(a) * v * u });
  const aim = (x: number, y: number) => Math.atan2(P.y - y, P.x - x);
  const spot = (): [number, number] => {
    for (let n = 0; n < 8; n++) {
      const x = G.W * (0.2 + Math.random() * 0.72), y = top + 30 + Math.random() * Math.max(40, bottom - top - 90);
      const far = (x - P.x) ** 2 + (y - P.y) ** 2 > (110 * u) ** 2, off = (x - bx) ** 2 + (y - by) ** 2 > (S * 0.8) ** 2;
      if ((far && off) || n === 7) return [x, y];
    }
    return [G.W / 2, (top + bottom) / 2];
  };

  // The boss's ways. Each says how long the boss waits after it.
  const SKILLS: Record<Exclude<Call, "">, () => number> = {
    // Streaming: volleys of orbs at the soul, spread.
    stream() {
      const n = B.phase === 1 ? 3 : 5, volleys = B.phase === 3 ? 3 : 2;
      for (let v = 0; v < volleys; v++)
        after(v * 420, () => {
          const a = aim(bx, by);
          for (let j = 0; j < n; j++) orb(bx, by, a + (j - (n - 1) / 2) * 0.24, 150 + B.phase * 12);
        });
      return volleys * 420;
    },
    // Echo: a ring out from the boss, a gap in it near the soul.
    echo() {
      const one = () => {
        const a = aim(bx, by) + (Math.random() - 0.5) * 0.7;
        waves.push({ rad: S * 0.45, gx: Math.cos(a), gy: Math.sin(a), gc: Math.cos(B.phase === 3 ? 0.3 : 0.38), hit: false });
      };
      one();
      if (B.phase > 1) after(850, one);
      return B.phase > 1 ? 1300 : 500;
    },
    // Parallel calls: orbs all round, twice.
    parallel() {
      for (let v = 0; v < 2; v++)
        after(v * 520, () => {
          const n = B.phase === 3 ? 16 : 12;
          for (let j = 0; j < n; j++) orb(bx, by, (j + v * 0.5) * (6.2832 / n), 120);
        });
      return 900;
    },
    // Extended thinking: a spiral of them.
    think() {
      const a0 = Math.random() * 6.28;
      for (let j = 0; j < 26; j++) after(j * 55, () => orb(bx, by, a0 + j * 0.55, 135));
      return 1500;
    },
    // Subagents: faces of the cast sent out; each strikes along a line through the soul.
    sub() {
      const cap = B.phase === 3 ? 3 : 2;
      for (let n = minions.filter((q) => !q.dead).length; n < cap; n++) {
        const [tx, ty] = spot();
        minions.push({ x: bx, y: by, tx, ty, r: 26 * u, hp: 34, max: 34, acc: 0, accAt: 0, flash: 0, bit: 2 << (born++ % 24), sp: (Math.random() * 64) | 0, next: E + 1500 + Math.random() * 900, born: E, dead: 0 });
      }
      return 700;
    },
    // Workflow: steps in a row, each going off after the one before it.
    flow() {
      let x = clamp(P.x + (Math.random() - 0.5) * 240 * u, 60, G.W - 60), y = clamp(P.y + (Math.random() - 0.5) * 160 * u, top + 50, bottom - 50);
      const n = B.phase === 3 ? 5 : 4;
      for (let j = 0; j < n; j++) {
        nodes.push({ x, y, at: E + 1000 + j * 430, hit: false });
        const a = aim(x, y) + (Math.random() - 0.5) * 1.6, d = (110 + Math.random() * 50) * u;
        x = clamp(x + Math.cos(a) * d, 50, G.W - 50);
        y = clamp(y + Math.sin(a) * d, top + 40, bottom - 40);
      }
      return 1000 + n * 430;
    },
    // Compaction: the pane pressed in from both sides to a column, held, let go.
    compact() {
      const half = Math.max(70, G.W * (B.phase === 3 ? 0.15 : 0.19));
      wall = { t: E, cx: clamp(P.x + (Math.random() - 0.5) * G.W * 0.3, half + 8, G.W - half - 8), half };
      B.compactAt = E + 15000;
      after(1900, () => SKILLS.stream());
      after(3300, () => SKILLS.stream());
      return 4600;
    },
  };
  const next = () => {
    const live = minions.filter((q) => !q.dead).length;
    const can: Exclude<Call, "">[] = ["stream", "echo"];
    if (live < (B.phase === 3 ? 3 : 2)) can.push("sub", "sub");
    if (B.phase >= 2) can.push("flow", "parallel");
    if (B.phase >= 2 && E > B.compactAt && !wall) can.push("compact", "compact");
    if (B.phase === 3) can.push("think", "think");
    let k = can[(Math.random() * can.length) | 0]!;
    if (k === B.last) k = can[(Math.random() * can.length) | 0]!;
    B.last = k;
    callAt = T;
    tell(hint, k);
    B.next = E + SKILLS[k]() + (B.phase === 1 ? 2300 : B.phase === 2 ? 1900 : 1500);
  };

  const shoot = () => {
    const isStar = Math.random() < 0.28, a = Math.random() * 6.2832, v = (110 + Math.random() * 150) * u;
    shots.push({ x: P.x, y: P.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: T, life: 1050, max: (isStar ? 120 + Math.random() * 60 : 95 + Math.random() * 60) * u, star: isStar, hit: 0, turn: Math.random() * 6, spin: (Math.random() - 0.5) * 2.4, was: 0 });
    if (shots.length > 22) shots.shift();
  };
  const along = (k: Rocket, s: number): [number, number] => {
    let i = 1;
    while (i < k.cum.length - 1 && k.cum[i]! < s) i++;
    const a = k.pts[i - 1]!, b = k.pts[i]!, w = clamp((s - k.cum[i - 1]!) / (k.cum[i]! - k.cum[i - 1]! || 1));
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const foes = (each: (e: Foe) => void) => {
    if (B.hp > 0) each(B);
    for (const q of minions) if (!q.dead) each(q);
  };

  const step = (dt: number) => {
    T += dt;
    (globalThis as any).__dbg = { T, mode, P, B, shots, minions, fxs, waves, floats, beams, nodes, faces: faces.map((f) => [f.w, f.h]), S, u, boss: [boss.w, boss.h] };
    const frozen = T < freeze, de = frozen ? 0 : dt, ds = de / 1000;
    E += de;
    B.x = bx;
    B.y = by + Math.sin(T / 900) * G.row * 0.7;
    P.shown += (P.hp - P.shown) * Math.min(1, dt / 260);
    P.def += ((P.hold ? 1 / 3 : 1) - P.def) * Math.min(1, dt / 90);
    if (mode === 0 && T > 2300) (mode = 1), (modeAt = T), (B.next = E + 1700);
    if (mode >= 2) {
      // Won: the boss goes in bursts. Either way, told once it is over.
      if (mode === 2 && T - modeAt < 1500 && ((T / 130) | 0) !== (((T - dt) / 130) | 0)) fx(bx + (Math.random() - 0.5) * S, by + (Math.random() - 0.5) * S, (60 + Math.random() * 90) * u, 700);
      if (T - modeAt > (mode === 2 ? 4200 : 3000)) (on = false), out.over();
    }
    // What to do, said one thing at a time, each till it has been done.
    if (mode < 2) {
      if (P.hold) heldFor += dt;
      const h: Hint = moved < 260 && T < 5200 ? "move" : heldFor < 1100 ? "hold" : !zigged && T < 46000 ? "zig" : "";
      tell(h, call && T - callAt < 2000 ? call : "");
    }
    // The soul's rings and stars, as long as it is held.
    if (P.hold && mode === 1 && T >= P.next) (P.next = T + 235), shoot();
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i]!, t = (T - s.t) / s.life;
      if (t >= 1) {
        shots.splice(i, 1);
        continue;
      }
      s.x += (s.vx * dt) / 1000;
      s.y += (s.vy * dt) / 1000;
      s.turn += (s.spin * dt) / 1000;
      const rad = s.max * (1 - (1 - t) ** 3), reach = s.star ? rad * 0.8 : rad;
      // Its outline come to a foe since the last frame: struck once.
      foes((e) => {
        if (s.hit & e.bit) return;
        const d2 = (e.x - s.x) ** 2 + (e.y - s.y) ** 2;
        if (d2 > (reach + e.r) ** 2 || (s.was > e.r && d2 < (s.was - e.r) ** 2)) return;
        s.hit |= e.bit;
        hurt(e, s.star ? DMG.star : DMG.ring);
      });
      // A star puts out the orbs its outline is on.
      if (s.star)
        for (let j = orbs.length - 1; j >= 0; j--) {
          const o = orbs[j]!, d2 = (o.x - s.x) ** 2 + (o.y - s.y) ** 2;
          if (d2 < (reach + 10) ** 2 && d2 > Math.max(0, reach - 26) ** 2) orbs.splice(j, 1), fx(o.x, o.y, 16, 260, 50);
        }
      s.was = reach;
    }
    // The rocket: time stands as its line is drawn; then along it, and out at its end.
    if (rocket) {
      const k = rocket, t = T - k.t;
      if (t >= STOP) {
        const w = clamp((t - STOP) / FLY), [hx, hy] = along(k, k.total * w * w);
        foes((e) => {
          if (k.hit & e.bit || (e.x - hx) ** 2 + (e.y - hy) ** 2 > (e.r + 18) ** 2) return;
          k.hit |= e.bit;
          hurt(e, DMG.pass);
        });
        if (w >= 1) {
          const R = 150 * u;
          foes((e) => (e.x - hx) ** 2 + (e.y - hy) ** 2 < (R + e.r) ** 2 && hurt(e, DMG.blast));
          orbs = orbs.filter((o) => (o.x - hx) ** 2 + (o.y - hy) ** 2 > (R * 1.15) ** 2);
          for (let j = 0; j < 3; j++) fx(hx, hy, R * (0.55 + j * 0.4), 620 + j * 160);
          out.shake(7);
          rocket = null;
          rocketOk = T + 900;
        }
      }
    }
    // Damage, said as numbers a little apart, not one a hit.
    foes((e) => {
      if (e.acc > 0 && T - e.accAt > 230) float(e.x + (Math.random() - 0.5) * e.r, e.y - e.r * 0.6, `-${Math.round(e.acc)}`, e === B ? ORANGE[0]![1]! : WHITE), (e.acc = 0), (e.accAt = T);
    });
    if (B.hp <= 0 && mode === 1) end(2);
    for (let i = minions.length - 1; i >= 0; i--) {
      const q = minions[i]!;
      if (q.hp <= 0 && !q.dead) (q.dead = E), heal(8), fx(q.x, q.y, 50 * u, 500);
      if (q.dead && E - q.dead > 450) minions.splice(i, 1);
    }
    if (mode !== 1) return;
    const ph = B.hp > B.max * 0.66 ? 1 : B.hp > B.max * 0.33 ? 2 : 3;
    if (ph !== B.phase) (B.phase = ph), heal(15), fx(bx, by, S, 700), (B.compactAt = E + 600);
    if (frozen) return;
    for (let i = later.length - 1; i >= 0; i--) if (later[i]!.at <= E) later.splice(i, 1)[0]!.fn();
    if (E >= B.next) next();
    const pr = 5 * u;
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i]!;
      o.x += o.vx * ds;
      o.y += o.vy * ds;
      if (o.x < -20 || o.x > G.W + 20 || o.y < top - 30 || o.y > bottom + 30) orbs.splice(i, 1);
      else if ((o.x - P.x) ** 2 + (o.y - P.y) ** 2 < (7 * u + pr) ** 2) orbs.splice(i, 1), strike(DMG.orb);
    }
    const far2 = G.W * G.W + G.H * G.H;
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i]!;
      w.rad += (140 + B.phase * 18) * u * ds;
      if (w.rad * w.rad > far2) {
        waves.splice(i, 1);
        continue;
      }
      const dx = P.x - bx, dy = P.y - by, d = Math.sqrt(dx * dx + dy * dy);
      if (!w.hit && Math.abs(d - w.rad) < 8 * u && (dx * w.gx + dy * w.gy) / (d || 1) < w.gc) (w.hit = true), strike(DMG.wave);
    }
    for (const q of minions) {
      if (q.dead) continue;
      const k = Math.min(1, ds * 2.2);
      q.x += (q.tx - q.x) * k;
      q.y += (q.ty - q.y) * k + Math.sin((E + q.sp * 90) / 500) * 0.25;
      if (E >= q.next) {
        const a = aim(q.x, q.y);
        beams.push({ ax: q.x, ay: q.y, dx: Math.cos(a), dy: Math.sin(a), t: E, hit: false });
        q.next = E + 2700 + Math.random() * 1100 - B.phase * 150;
        after(WARN + LIVE, () => ([q.tx, q.ty] = spot()));
      }
    }
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i]!, t = E - b.t;
      if (t > WARN + LIVE) beams.splice(i, 1);
      else if (t > WARN && !b.hit) {
        const rx = P.x - b.ax, ry = P.y - b.ay;
        if (rx * b.dx + ry * b.dy > 0 && Math.abs(rx * b.dy - ry * b.dx) < 9 * u + pr) (b.hit = true), strike(DMG.beam);
      }
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]!;
      if (E >= n.at && !n.hit) {
        n.hit = true;
        fx(n.x, n.y, 78 * u, 380, 2);
        if ((n.x - P.x) ** 2 + (n.y - P.y) ** 2 < (78 * u) ** 2) strike(DMG.node);
      }
      if (E > n.at + 300) nodes.splice(i, 1);
    }
    wallL = 0;
    wallR = G.W;
    if (wall) {
      const t = E - wall.t, k = t < 900 ? 0 : t < 1500 ? (t - 900) / 600 : t < 4300 ? 1 : 1 - (t - 4300) / 500;
      if (t > 4800) wall = null;
      else {
        const e = k * k * (3 - 2 * k);
        wallL = (wall.cx - wall.half) * e;
        wallR = G.W - (G.W - wall.cx - wall.half) * e;
        if ((P.x < wallL || P.x > wallR) && E > P.wall) (P.wall = E + 380), (P.inv = 0), strike(DMG.wall);
      }
    }
  };

  // ——— Drawn ———

  const paint = () => {
    const cw = G.cw, ROW = G.row, tk = (T / 70) | 0, hue = (T / 28) | 0;
    const blink = mode !== 3 && T % 4200 < 130;
    // The walls, under everything.
    if (wall) {
      const t = E - wall.t, r0 = (top / ROW) | 0, r1 = Math.min(G.rows - 1, (bottom / ROW) | 0), fl = wall.cx - wall.half, fr = wall.cx + wall.half;
      for (let r = r0; r <= r1; r++) {
        if (wallL > 1) span(r, 0, wallL - cw * 2, WALL), span(r, wallL - cw * 2, wallL, EDGE);
        if (wallR < G.W - 1) span(r, wallR + cw * 2, G.W + cw, WALL), span(r, wallR, wallR + cw * 2, EDGE);
        // Where they will close to, marked ahead: a dashed line, going down.
        if (t < 1500 && ((r + tk) & 3) < 2) span(r, fl - cw * 1.5, fl, dim(EDGE, 4)), span(r, fr, fr + cw * 1.5, dim(EDGE, 4));
      }
    }
    // Workflow: the steps, the lines between them, each one's reach as it is about to go.
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!, left = n.at - E, m = nodes[i + 1];
      if (m && left > 0) line(n.x, n.y, m.x, m.y, cw * 0.5, dim(EDGE, 2));
      if (left <= 0) continue;
      const hot = left < 500, d = 13 * u, k = hot ? ((tk & 1) ? FLASH : HURT) : dim(HURT, 5);
      line(n.x, n.y - d, n.x + d, n.y, cw * 0.6, k);
      line(n.x + d, n.y, n.x, n.y + d, cw * 0.6, k);
      line(n.x, n.y + d, n.x - d, n.y, cw * 0.6, k);
      line(n.x - d, n.y, n.x, n.y - d, cw * 0.6, k);
      if (left < 650) ring(n.x, n.y, 78 * u, cw * 0.8, RED[2]!, tk);
    }
    for (const b of beams) {
      const t = E - b.t, L = G.W + G.H;
      if (t < WARN) (t > WARN - 260 ? tk & 1 : 1) && line(b.ax, b.ay, b.ax + b.dx * L, b.ay + b.dy * L, cw * 0.5, dim(HURT, t > WARN - 260 ? 5 : 3));
      else line(b.ax, b.ay, b.ax + b.dx * L, b.ay + b.dy * L, 8 * u, RED[0]![tk & 3]!), line(b.ax, b.ay, b.ax + b.dx * L, b.ay + b.dy * L, 2 * u, FLASH);
    }
    for (const s of shots) {
      const t = (T - s.t) / s.life, rad = s.max * (1 - (1 - t) ** 3), a = t < 0.6 ? 0 : t < 0.82 ? 1 : 2;
      if (s.star) star(s.x, s.y, rad, s.turn, PURPLE[a]!);
      else ring(s.x, s.y, rad, ROW * 0.7, ORANGE[a]!, tk);
    }
    for (const f of fxs) {
      const t = (T - f.t) / f.life;
      if (t < 1) ring(f.x, f.y, Math.max(cw, f.max * (1 - (1 - t) ** 3)), ROW * (1.3 - t), RB[t < 0.55 ? 7 : t < 0.8 ? 5 : 3]!.subarray((f.hue + hue) & 31, ((f.hue + hue) & 31) + 12), 0);
    }
    for (const w of waves) ring(bx, by, w.rad, 7 * u, RED[0]!, tk, w.gx, w.gy, w.gc);
    // The boss: coming, cell by cell; struck, flashing; its tail swinging; beaten, going.
    const show = mode === 0 ? clamp((T - 900) / 1200) : mode === 2 ? 1 - clamp((T - modeAt) / 1500) : 1;
    if (show > 0) {
      const x = bx - (boss.w * cw) / 2, y = B.y - (boss.h * ROW) / 2;
      if (show >= 1) {
        let px = bx + S * 0.3, py = B.y + S * 0.38;
        for (let j = 1; j <= 5; j++) {
          const a = 0.5 + Math.sin(T / 520 + j * 0.7) * 0.5 - j * 0.16, qx = px + Math.cos(a) * S * 0.09, qy = py + Math.sin(a) * S * 0.09;
          line(px, py, qx, qy, cw * (1.5 - j * 0.15), TAIL);
          (px = qx), (py = qy);
        }
      }
      stamp(boss, x, y, show, T < B.flash ? FLASH : 0, blink ? dim(TAIL, 7) : B.phase === 3 ? RED[0]![tk & 3]! : 1, hue);
    }
    const mw = faces[0]?.w ?? bot.w, mh = faces[0]?.h ?? bot.h;
    for (const q of minions) {
      const s = faces.length ? faces[q.sp % faces.length]! : bot;
      stamp(s, q.x - (mw * cw) / 2, q.y - (mh * ROW) / 2, q.dead ? 1 - (E - q.dead) / 450 : clamp((E - q.born) / 500), T < q.flash ? FLASH : 0);
      if (!q.dead && q.hp < q.max) bar(q.x - 20 * u, q.x - 20 * u + (40 * u * Math.max(0, q.hp)) / q.max, q.y + (mh * ROW) / 2 + 2, 1, HP);
    }
    for (const o of orbs) disc(o.x, o.y, 7 * u, RED[0]![(tk + ((o.x + o.y) | 0)) & 3]!);
    // The rocket's line: lit along as time stands; then bright behind its head.
    if (rocket) {
      const k = rocket, t = T - k.t, head = t < STOP ? k.total * clamp(t / (STOP * 0.75)) : k.total * clamp((t - STOP) / FLY) ** 2;
      for (let i = 1; i < k.pts.length; i++) {
        const a = k.pts[i - 1]!, b = k.pts[i]!, s0 = k.cum[i - 1]!, s1 = k.cum[i]!;
        if (t >= STOP) line(a[0], a[1], b[0], b[1], cw * 0.6, RB[3]![(hue + i * 6) & 63]!);
        if (head <= s0) continue;
        const [ex, ey] = head >= s1 ? b : along(k, head);
        line(a[0], a[1], ex, ey, t < STOP ? cw : 5 * u, RB[7]![(hue + i * 6) & 63]!);
      }
      if (t >= STOP) {
        const [hx, hy] = along(k, head);
        disc(hx, hy, 11 * u, FLASH);
      }
    }
    // Iridium's letters going over to the boss as it comes: lit cells from one to the other.
    if (mode === 0 && T > 250 && T < 2000)
      for (let j = 0; j < 70; j++) {
        const h = hsh(j), p = clamp((T - 250 - ((h >>> 8) & 255) * 3.2) / 800);
        if (p <= 0 || p >= 1) continue;
        const e = p * p * (3 - 2 * p), sx = fx0 + ((h & 255) / 255 - 0.5) * fs * 0.6, sy = fy0 + (((h >>> 16) & 255) / 255 - 0.5) * fs * 0.5;
        const tx = bx + (((h >>> 20) & 255) / 255 - 0.5) * S * 0.8, ty = by + (((h >>> 12) & 255) / 255 - 0.5) * S * 0.7;
        dot(sx + (tx - sx) * e, sy + (ty - sy) * e - Math.sin(p * 3.14) * 40 * u, RB[7]![(j + hue) & 63]!, 3);
      }
    // The soul: a heart where the pointer is; faint between strikes it cannot take.
    if (mode !== 3 || T - modeAt < 600) {
      const gone = mode === 3 ? 1 - (T - modeAt) / 600 : mode === 0 ? clamp((T - 1200) / 600) : 1;
      if (T >= P.inv || (tk & 1)) stamp(soul, P.x - 4.5 * cw, P.y - 2.5 * ROW, gone, T < P.inv ? FLASH : 0);
    }
    for (const f of floats) {
      const t = (T - f.t) / 800;
      if (t < 1) digits(f.s, f.x, f.y - t * 26 - 5 * ROW, t > 0.75 ? dim(f.k, 4) : f.k);
    }
    // The bars. The boss's under it; the soul's at the upper right: its heart (the one pressed to
    // begin; pressed again, the game is left), its life, and under them its defence.
    const full = mode === 0 ? clamp((T - 1500) / 700) : 1;
    if (show > 0 && mode !== 2) {
      const y = by + (boss.h * ROW) / 2 + ROW * 1.5, x0 = bx - S / 2, hp = Math.max(0, B.hp) / B.max, tall = S > 150 ? 2 : 1;
      bar(x0, x0 + S, y, tall, dim(HURT, 2));
      bar(x0, x0 + S * hp * full, y, tall, B.phase === 3 ? HURT : B.phase === 2 ? PURPLE[0]![1]! : PURPLE[0]![0]!);
      for (let j = 1; j < 3; j++) bar(x0 + (S * j) / 3 - cw / 2, x0 + (S * j) / 3 + cw / 2, y, tall, WHITE);
    }
    const hx = hudX(), hy = hudY(), bw = clamp(G.W * 0.28, 84, 200), x1 = hx - 8, x0 = x1 - bw;
    stamp(soul, hx, hy, 1, P.hp <= 30 && (tk & 4) ? HPLOW : 0);
    bar(x0, x1, hy + ROW, 2, dim(HP, 2));
    bar(x0, x0 + (bw * P.shown * full) / 100, hy + ROW, 2, GHOST);
    bar(x0, x0 + (bw * P.hp * full) / 100, hy + ROW, 2, P.hp <= 30 ? HPLOW : HP);
    stamp(shield, hx, hy + ROW * 7, 1, P.hold ? dim(DEF, 3) : 0);
    // Three parts: all of them at rest, one while it attacks.
    for (let j = 0; j < 3; j++) bar(x0 + (bw * j) / 3, x0 + (bw * (j + 1)) / 3 - cw * 1.2, hy + ROW * 8, 2, P.def * 3 * full > j + 0.5 ? DEF : dim(DEF, 2));
    // Won or lost, in cells across the pane.
    if (mode >= 2 && T - modeAt > 500) {
      const s = say(mode === 2 ? words.win : words.lose);
      stamp(s, G.W / 2 - (s.w * cw) / 2, (top + bottom) / 2 - (s.h * ROW) / 2, clamp((T - modeAt - 500) / 700), 0, mode === 2 ? 1 : HURT, hue);
    }
  };

  return {
    /** from: where Iridium's letters are (their middle, their side). */
    start(isDark: boolean, from: [number, number, number], who: Cast[]) {
      dark = isDark;
      cast = who;
      built = "";
      [fx0, fy0, fs] = from;
      on = true;
      T = E = freeze = 0;
      mode = modeAt = 0;
      hint = call = "";
      moved = heldFor = 0;
      zigged = false;
      minions = [];
      shots = [];
      orbs = [];
      waves = [];
      beams = [];
      nodes = [];
      fxs = [];
      floats = [];
      later = [];
      wall = null;
      rocket = null;
      rocketOk = 0;
      Object.assign(B, { hp: B.max, acc: 0, accAt: 0, flash: 0, phase: 1, next: 1e12, last: "", compactAt: 0 });
      layout();
      Object.assign(P, { x: G.W * 0.62, y: top + (bottom - top) * 0.7, hp: 100, shown: 100, inv: 0, hold: false, def: 1, next: 0, wall: 0 });
    },
    stop: () => void (on = false),
    /** Time stood still (a rocket's line being drawn): the code's flow stands too. */
    still: () => on && T < freeze,
    /** Where the boss's way is named: under its bar. */
    label: (): [number, number] => [bx - S / 2, by + (boss.h * G.row) / 2 + G.row * 4],
    on: () => on,
    clock: () => T,
    /** The fight itself going (not coming, not over): the pane's presses are its own. */
    live: () => on && mode < 2,
    step,
    paint,
    /** The pane's room: under its top bar, over the composer. */
    bounds(t: number, b: number) {
      if (t === top && b === bottom) return;
      top = t;
      bottom = Math.max(t + 160, b);
      if (on) layout();
    },
    resized: () => on && layout(),
    tone(isDark: boolean) {
      if (isDark === dark) return;
      dark = isDark;
      if (on) build();
    },
    move(x: number, y: number) {
      const nx = clamp(x, 6, G.W - 6), ny = clamp(y, top + 4, bottom - 4);
      moved += Math.abs(nx - P.x) + Math.abs(ny - P.y);
      P.x = nx;
      P.y = ny;
    },
    press(down: boolean) {
      P.hold = down && mode === 1;
    },
    /** A zigzag drawn: the rocket, if none is on its way. True if it is taken. */
    zig(pts: [number, number][]) {
      if (mode !== 1 || rocket || T < rocketOk) return false;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
      rocket = { pts, cum, total: cum.at(-1)!, t: T, hit: 0 };
      freeze = T + STOP;
      zigged = true;
      return true;
    },
    /** The heart at the upper right, to be drawn with no game on: where it is. */
    heart: (): [number, number] => [hudX(), hudY()],
    soul: () => soul,
    stamp,
    ready(isDark: boolean) {
      dark = isDark;
      if (!soul.k.some((k) => k)) (HP = key(255, 59, 92)), (soul = bitmap(HEART, HP));
    },
  };
}
export type Game = ReturnType<typeof game>;
