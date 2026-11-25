// The splash's little game (kumo, 2026-11-26): a zigzag's rocket gone off, faces are thrown up from
// under the pane (the roles' and the agents'), to be cut through with a stroke of the pointer or a
// finger; among them Iridium's own mark on its rounded square, which is not to be cut: cut, it is
// over. Three faces let fall uncut, over too. Nothing in it is a character of its own: the code's
// rows flow on and the faces, the blade, the count are the colours of the cells under them
// (engine.ts lays them: Env).
import type { Agent } from "../api/types.gen";

export type Cast = { src?: string; agent?: Agent };
/** A picture in cells: w by h, each its colour (0xAABBGGRR; 0: none). */
export type Sprite = { w: number; h: number; px: Uint32Array };
export type Env = {
  W(): number;
  H(): number;
  /** The pane's room for it: from under its top bar to the composer's top. */
  top(): number;
  bottom(): number;
  cw(): number;
  row: number;
  cols(): number;
  rows(): number;
  /** How far along a cell row r's flow is. */
  frac(r: number): number;
  /** Cell i in this colour. */
  put(i: number, c: number): void;
  /** A line of light from a to b, w to each side, as strong as v. */
  line(ax: number, ay: number, bx: number, by: number, w: number, v: number): void;
  /** Stars flung out from a point: how many, how fast, how large, of light (or any colours). */
  burst(x: number, y: number, n: number, speed: number, size: number, light: boolean): void;
  /** One of the cast, or Iridium's mark (null), as cells, size px across. */
  sprite(who: Cast | null, size: number): Promise<Sprite | null>;
  over(): void;
};

/** ux, uy: the way the stroke that cut it went. */
type Thing = { s: Sprite; bomb: boolean; x: number; y: number; vx: number; vy: number; cut: number; dx: number; up: boolean; ux: number; uy: number };
const FALL = 560; // px a second each second
// Digits, three cells by five, a bit a cell from the upper left.
const FONT = [0x7b6f, 0x2c97, 0x73e7, 0x73cf, 0x5bc9, 0x79cf, 0x79ef, 0x7249, 0x7bef, 0x7bcf];
const RED = 0xff5c3bff, GREY = 0x60808080, INK = 0xffffffff;

export function slicer(E: Env) {
  let on = false, T = 0, next = 0, score = 0, lost = 0, endAt = 0, made = "";
  // The faces large (a face is like itself only large: kumo, 2026-11-26), and the agents' marks
  // small too (a picture small is a blur: none of those).
  let faces: Sprite[] = [], marks: Sprite[] = [], bomb: Sprite | null = null;
  let slashes: { x: number; y: number; dx: number; dy: number; t: number }[] = [];
  let things: Thing[] = [];
  let blade: { x: number; y: number; t: number }[] = [];
  let cast: Cast[] = [];
  const size = () => Math.max(84, Math.min(150, Math.min(E.W(), E.bottom() - E.top()) * 0.25));

  /** The sprites, for the pane as large as it is now; made again as that changes. */
  const make = async () => {
    const px = size(), sig = `${Math.round(px)}|${E.cw()}`;
    if (sig === made) return;
    made = sig;
    const got: Sprite[] = [], small: Sprite[] = [];
    for (const who of cast) {
      // Not all one size: each a little larger or smaller than the last.
      const s = await E.sprite(who, px * (0.8 + 0.4 * ((got.length * 0.618) % 1))).catch(() => null);
      if (made !== sig) return;
      if (s) got.push(s);
      if (who.src) continue;
      const m = await E.sprite(who, px * 0.55).catch(() => null);
      if (made !== sig) return;
      if (m) small.push(m);
    }
    const b = await E.sprite(null, px).catch(() => null);
    if (made !== sig) return;
    faces = got;
    marks = small;
    bomb = b;
  };

  /** side: 0 all of it; 1, -1: the half of it to that side of the line through its middle that
   *  goes the way (ux, uy). */
  const stamp = (s: Sprite, x: number, y: number, side = 0, ux = 0, uy = 0) => {
    const cw = E.cw(), ROW = E.row, cols = E.cols(), rows = E.rows(), r0 = Math.round((y - (s.h * ROW) / 2) / ROW);
    for (let sr = 0; sr < s.h; sr++) {
      const r = r0 + sr;
      if (r < 0 || r >= rows) continue;
      const k0 = Math.floor((x - (s.w * cw) / 2) / cw + E.frac(r) + 0.5), oy = (sr + 0.5 - s.h / 2) * ROW;
      for (let sc = 0; sc < s.w; sc++) {
        const c = s.px[sr * s.w + sc]!, k = k0 + sc;
        if (!c || k < 0 || k >= cols) continue;
        if (side && ((sc + 0.5 - s.w / 2) * cw * uy - oy * ux) * side < 0) continue;
        E.put(r * cols + k, c);
      }
    }
  };
  /** A block of cells: cells wide and rows tall, its upper left at (x, y). */
  const block = (x: number, y: number, wide: number, tall: number, c: number) => {
    const cw = E.cw(), cols = E.cols(), rows = E.rows(), r0 = Math.round(y / E.row);
    for (let r = Math.max(0, r0); r < Math.min(rows, r0 + tall); r++) {
      const k0 = Math.floor(x / cw + E.frac(r) + 0.5);
      for (let k = Math.max(0, k0); k < Math.min(cols, k0 + wide); k++) E.put(r * cols + k, c);
    }
  };
  /** A number in cells, each point of a digit z rows tall and twice as many cells wide; its middle at x. */
  const digits = (n: number, x: number, y: number, z: number, c: number) => {
    const s = String(n), cw = E.cw(), one = 8 * z * cw;
    let at = x - (s.length * one - 2 * z * cw) / 2;
    for (const ch of s) {
      const bits = FONT[+ch]!;
      for (let b = 0; b < 15; b++) if (bits & (1 << (14 - b))) block(at + (b % 3) * 2 * z * cw, y + ((b / 3) | 0) * z * E.row, 2 * z, z, c);
      at += one;
    }
  };

  const toss = () => {
    const W = E.W(), top = E.top(), bot = E.bottom(), isBomb = !!bomb && score > 1 && Math.random() < 0.2;
    const from = marks.length && Math.random() < 0.22 ? marks : faces;
    const s = isBomb ? bomb! : from[(Math.random() * from.length) | 0];
    if (!s) return;
    // Each in a way of its own (kumo, 2026-11-26: one over another, in characters, they cannot be
    // told apart): thrown where it is farthest from those in the air, and nearly straight up.
    const half = (s.w * E.cw()) / 2, lo = half + 6, hi = Math.max(lo + 1, W - half - 6);
    let x = W / 2, best = -1;
    for (let n = 0; n < 9; n++) {
      const c = lo + Math.random() * (hi - lo);
      let near = 1e9;
      for (const q of things) if (!q.cut) near = Math.min(near, Math.abs(q.x - c) - (q.s.w * E.cw()) / 2 - half);
      if (near > best) (best = near), (x = c);
    }
    // No room for one more beside the others: not thrown now.
    if (things.length && best < 4) return;
    const rise = (bot - top) * (0.55 + Math.random() * 0.3);
    things.push({ s, bomb: isBomb, x, y: bot + size() * 0.7, vx: (Math.random() - 0.5) * 36, vy: -Math.sqrt(2 * FALL * (rise + size())), cut: 0, dx: 0, up: false, ux: 1, uy: 0 });
  };
  const end = () => {
    if (endAt) return;
    endAt = T;
    blade = [];
  };

  return {
    on: () => on,
    cast: (who: Cast[]) => void ((cast = who), (made = "")),
    start() {
      if (on) return;
      on = true;
      T = score = lost = endAt = 0;
      next = 500;
      things = [];
      blade = [];
      slashes = [];
      void make();
    },
    stop: () => void (on = false),
    /** The pointer's way from a to b, pressed: what it goes through is cut. */
    move(ax: number, ay: number, bx: number, by: number) {
      if (!on || endAt) return;
      blade.push({ x: bx, y: by, t: T });
      if (blade.length > 22) blade.shift();
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      if (L2 < 9) return;
      for (const q of things) {
        if (q.cut) continue;
        // How near the stroke comes to its middle.
        const u = Math.max(0, Math.min(1, ((q.x - ax) * dx + (q.y - ay) * dy) / L2)), rad = (q.s.h * E.row) / 2;
        if ((ax + dx * u - q.x) ** 2 + (ay + dy * u - q.y) ** 2 > rad * rad) continue;
        if (q.bomb) {
          E.burst(q.x, q.y, 16, 320, 44, true);
          q.cut = T || 1;
          return end();
        }
        q.cut = T || 1;
        score++;
        E.burst(q.x, q.y, 5, 170, 20, false);
        // The cut itself: a line of light through it, the way the stroke went; its halves part
        // to either side of that line.
        const L = Math.sqrt(L2);
        (q.ux = dx / L), (q.uy = dy / L);
        slashes.push({ x: q.x, y: q.y, dx: (dx / L) * rad * 1.7, dy: (dy / L) * rad * 1.7, t: T });
        if (slashes.length > 6) slashes.shift();
      }
    },
    lift: () => void (blade = []),
    step(ms: number) {
      if (!on) return;
      T += ms;
      void make();
      const dt = ms / 1000, bot = E.bottom(), far = bot + size() * 1.5;
      if (endAt) {
        if (T - endAt > 2600) (on = false), E.over();
      } else if (T >= next && faces.length) {
        // A few at a time (kumo, 2026-11-26: more of them), more as the count grows.
        const n = 1 + (Math.random() < 0.55 ? 1 : 0) + (score > 8 && Math.random() < 0.4 ? 1 : 0) + (score > 20 && Math.random() < 0.4 ? 1 : 0);
        for (let j = 0; j < n; j++) toss();
        next = T + Math.max(700, 1250 - score * 10) * (0.8 + Math.random() * 0.4);
      }
      for (let i = things.length - 1; i >= 0; i--) {
        const q = things[i]!;
        q.vy += FALL * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        if (q.cut) q.dx += 110 * dt;
        if (q.y < bot) q.up = true;
        if (q.y > far && q.vy > 0) {
          things.splice(i, 1);
          // One let fall whole: three, and it is over.
          if (!q.cut && !q.bomb && q.up && !endAt && ++lost >= 3) end();
        }
      }
    },
    paint() {
      if (!on) return;
      const cw = E.cw(), W = E.W(), top = E.top();
      for (const q of things) {
        if (!q.cut) stamp(q.s, q.x, q.y);
        else if (!q.bomb) {
          // Its two halves, each to its own side of the cut (kumo, 2026-11-26: cut the way the
          // stroke went, not always upright).
          stamp(q.s, q.x + q.uy * q.dx, q.y - q.ux * q.dx, 1, q.ux, q.uy);
          stamp(q.s, q.x - q.uy * q.dx, q.y + q.ux * q.dx, -1, q.ux, q.uy);
        }
      }
      // The blade: where the stroke has just been, widest and brightest at its point, to nothing
      // behind it in a third of a second.
      for (let i = 1; i < blade.length; i++) {
        const a = blade[i - 1]!, b = blade[i]!, age = (T - b.t) / 320;
        if (age < 1) E.line(a.x, a.y, b.x, b.y, cw * 0.5 + E.row * 1.1 * (1 - age) ** 1.6, 1 - age * age);
      }
      for (const c of slashes) {
        const age = (T - c.t) / 200;
        if (age < 1) E.line(c.x - c.dx, c.y - c.dy, c.x + c.dx, c.y + c.dy, cw * 0.5 + E.row * 0.9 * (1 - age), 1 - age);
      }
      // The count at the top; under it the three that may fall, each gone red as one does.
      if (!endAt) {
        digits(score, W / 2, top + 10, 1, INK);
        for (let j = 0; j < 3; j++) block(W / 2 + (j - 1) * 5 * cw - cw, top + 10 + 7 * E.row, 2, 1, j < lost ? RED : GREY);
      } else {
        // Over: the count, large, in the pane's middle, coming and going.
        const t = (T - endAt) / 2600, z = Math.max(2, Math.min(5, Math.round(W / 130)));
        if (t > 0.12 && t < 0.92) digits(score, W / 2, (top + E.bottom()) / 2 - 2.5 * z * E.row, z, INK);
      }
    },
  };
}
export type Slicer = ReturnType<typeof slicer>;
