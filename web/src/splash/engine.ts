// The splash's drawing (splash.tsx; kumo, 2026-11-25): a band of code in small characters, each
// cell of it as dark and as coloured as the figure behind it is there, so that the characters
// draw the figure: Iridium's letters, an agent's mark, a face. It moves only as something
// changes: the code flows for a moment as the band comes and as its figure changes, the cells
// going over to the new figure from its middle outwards; the characters about the pointer
// change as it passes. Otherwise nothing is drawn again.
import type { Agent } from "../api/types.gen";
import { AGY_DATA_URI, CLAUDE, DSH, DSH_VIEWBOX, OPENAI, OPENAI_VIEWBOX, PI, PI_VIEWBOX } from "../logos";
import type { Fig } from "./figure";

const FONT = 9; // px
const ROW = 10; // px, a row's height
const SRC = 256; // px, the figure as it is drawn before the cells are read from it
const BASE = 0.12; // a cell's opacity with no figure on it
const TURN = 700; // ms, one cell going over
const SPREAD = 650; // ms, from the middle's first cell to the rim's
const NEAR = 60; // px about the pointer
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

type RGB = [number, number, number];
type Field = { a: Float32Array; r: Float32Array; g: Float32Array; b: Float32Array };
const field = (n: number): Field => ({ a: new Float32Array(n), r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) });
const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0]!;

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

/** Iridium's letters (ui.tsx IrMark's, with no square about them). */
function letters(g: CanvasRenderingContext2D, ink: string) {
  const k = (SRC * 0.78) / 28;
  g.save();
  g.translate(SRC / 2 - 32 * k, SRC / 2 - 32 * k);
  g.scale(k, k);
  g.fillStyle = ink;
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

export type Splash = { figure(f: Fig | null): void; place(x: number, side: number): void; resize(): void; near(x: number, y: number): void; stop(): void };

export function splash(cv: HTMLCanvasElement, still: boolean): Splash {
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
  let cx = -1, most = 0; // where the figure's middle is and how large it may be; -1: the band's own
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
      return true;
    }
    if (img) sg.drawImage(img, SRC * 0.1, SRC * 0.1, SRC * 0.8, SRC * 0.8);
    else if (!f?.agent || !mark(sg, f.agent, css)) letters(sg, css);
    return false;
  };

  /** Each cell's opacity and colour for the square as it is painted. */
  const read = (): Field => {
    const n = cols * rows, out = field(n);
    if (!n) return out;
    const mid = cx < 0 ? W / 2 : cx, side = cx < 0 ? Math.min(H * 0.92, W * 0.7) : most, fx = mid - side / 2, fy = (H - side) / 2;
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
    // The same, larger and out of focus (drawn small, then stretched): what the cells about the
    // figure take of its colours, thinning outwards.
    const tw = Math.max(2, Math.round(cols / 10)), th = Math.max(2, Math.round(rows / 5));
    tiny.width = tw;
    tiny.height = th;
    const grow = 1.5, hs = side * grow, hx = mid - hs / 2, hy = (H - hs) / 2;
    tg.drawImage(src, (hx / W) * tw, (hy / H) * th, (hs / W) * tw, (hs / H) * th);
    mg.clearRect(0, 0, cols, rows);
    mg.drawImage(tiny, 0, 0, cols, rows);
    const halo = mg.getImageData(0, 0, cols, rows).data;
    const vivid = (r: number, g: number, b: number, k: number, gain: number): RGB => {
      const m = (r + g + b) / 3;
      return [clamp((m + (r - m) * k) * gain, 0, 255), clamp((m + (g - m) * k) * gain, 0, 255), clamp((m + (b - m) * k) * gain, 0, 255)];
    };
    for (let i = 0; i < n; i++) {
      const o = i * 4, m = sharp[o + 3]! / 255, h = halo[o + 3]! / 255;
      let a = BASE, c: RGB = ink;
      const hc = vivid(halo[o]!, halo[o + 1]!, halo[o + 2]!, 1.5, dark ? 1.15 : 0.9);
      if (photo && m > 0.5) {
        const lum = (0.3 * sharp[o]! + 0.59 * sharp[o + 1]! + 0.11 * sharp[o + 2]!) / 255;
        a = 0.3 + 0.7 * Math.pow(dark ? lum : 1 - lum, 0.75);
        c = vivid(sharp[o]!, sharp[o + 1]!, sharp[o + 2]!, 1.5, dark ? 1.2 : 0.85);
      } else {
        const w = clamp(h * (photo ? 1.25 : 0.9) * (1 - (photo ? 0 : m)));
        c = [ink[0] + (hc[0] - ink[0]) * w, ink[1] + (hc[1] - ink[1]) * w, ink[2] + (hc[2] - ink[2]) * w];
        a = BASE + w * (photo ? 0.3 : 0.12);
        if (!photo && m > 0) {
          c = [c[0] + (sharp[o]! - c[0]) * m, c[1] + (sharp[o + 1]! - c[1]) * m, c[2] + (sharp[o + 2]! - c[2]) * m];
          a += m * 0.62;
        }
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
    for (let r = 0; r < rows; r++) {
      const o = Math.floor(off[r]!), f = off[r]! - o, row = text[r]!, y = r * ROW + 0.5;
      let run = "", at = 0, key = -1;
      const flush = () => {
        if (!run || !(key & 31)) return;
        g.fillStyle = `rgba(${((key >> 5) & 31) << 3},${((key >> 10) & 31) << 3},${((key >> 15) & 31) << 3},${(key & 31) / 24})`;
        g.fillText(run, (at - f) * cw, y);
      };
      for (let k = 0; k < cols; k++) {
        const i = r * cols + k;
        const k2 = Math.min(24, Math.round(clamp(cur.a[i]! + heat[i]! * 0.34) * 24)) | ((cur.r[i]! >> 3) << 5) | ((cur.g[i]! >> 3) << 10) | ((cur.b[i]! >> 3) << 15);
        if (k2 !== key) {
          flush();
          run = "";
          at = k;
          key = k2;
        }
        run += busy[i] && Math.random() < 0.4 ? glyph() : row[(k + o) % len]!;
      }
      flush();
    }
  };

  const frame = (now: number) => {
    raf = 0;
    if (dead) return;
    const dt = Math.min(50, now - last) / 1000;
    last = now;
    const flow = clamp((flowTo - now) / 900);
    if (flow > 0) for (let r = 0; r < rows; r++) off[r] = (off[r]! + speed[r]! * flow * dt + len) % len;
    const span = now - t0;
    const turning = span < SPREAD + TURN + 400;
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
    } else if (wasTurning) busy.fill(0);
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
      if (Math.random() < h * 0.25) {
        const r = (i / cols) | 0, at = ((i % cols) + Math.floor(off[r]!)) % len;
        if (now - overAt[r]! > 600) (over[r] = CODE[(Math.random() * CODE.length) | 0]! + "  "), (overAt[r] = now);
        text[r]![at] = over[r]![at % over[r]!.length]!;
      }
      heat[i] = h * 0.9;
    }
    draw();
    if (flow > 0 || turning || hot) kick();
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
      return;
    }
    from = { a: cur.a.slice(), r: cur.r.slice(), g: cur.g.slice(), b: cur.b.slice() };
    const far = Math.hypot(W / 2, H / 2) || 1;
    for (let i = 0; i < wait.length; i++) wait[i] = (Math.hypot(((i % cols) + 0.5) * cw - (cx < 0 ? W / 2 : cx), (((i / cols) | 0) + 0.5) * ROW - H / 2) / far) * SPREAD * (0.75 + Math.random() * 0.5);
    last = t0 = performance.now();
    flowTo = t0 + (first ? 2600 : 1700);
    first = false;
    kick();
  };

  const show = (f: Fig | null, snap: boolean) => {
    const n = ++asked;
    void paint(f).then((isPhoto) => {
      if (n !== asked || dead) return;
      photo = isPhoto;
      drawnKey = f?.key ?? "";
      turn(snap);
    });
  };

  const resize = () => {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h || (w === W && h === H)) return;
    const grown = W > 0;
    W = w;
    H = h;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    g.font = `${FONT}px ui-monospace, "SF Mono", Menlo, "JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace`;
    cw = g.measureText("M").width || 5.4;
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
      text.push(line(len));
      off[r] = Math.random() * len;
      speed[r] = (r % 2 ? -1 : 1) * (1.5 + Math.random() * 3.5); // cells a second
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
    place(x, side) {
      if (Math.abs(x - cx) < 1 && Math.abs(side - most) < 1) return;
      const had = cx !== -1 || x !== -1;
      cx = x;
      most = side;
      if (W && had && drawnKey === (fig?.key ?? "")) turn(false);
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
      last = performance.now();
      kick();
    },
    stop() {
      dead = true;
      cancelAnimationFrame(raf);
    },
  };
}
