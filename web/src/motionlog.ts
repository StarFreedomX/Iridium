// What moved the page, and why (docs/动画调查.md §3.1 "移动记录"): each thing that moves rows, changes
// a row's height by an animation, or writes a scroll position says so here, with its reason. Only
// a record: it changes nothing. Read by the probes (web/scripts) as window.__moves; the last ones
// kept.
export type Move = {
  /** performance.now() */
  t: number;
  /** Which of the page's movers did it (stick.glide, stick.pin, moves.play, …). */
  who: string;
  /** Why: what changed (tail, send, pad, pane, fold, floor, page, reorder, leave, …); "?" when
   *  the mover only saw a height change and was told nothing. */
  why: string;
  /** px, down positive; ms it runs. */
  dy?: number;
  ms?: number;
  /** How many rows it is on, or what else there is to say. */
  n?: number;
  note?: string;
};

const KEPT = 2000;
const log: Move[] = [];
if (typeof window !== "undefined") (window as unknown as { __moves: Move[] }).__moves = log;

export function moveLog(who: string, why: string, more: Omit<Move, "t" | "who" | "why"> = {}) {
  if (log.length >= KEPT) log.splice(0, KEPT / 2);
  log.push({ t: Math.round(performance.now()), who, why, ...more });
}
