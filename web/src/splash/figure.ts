// What the splash's characters draw (splash.tsx): a face (src), failing that its agent's mark,
// failing both Iridium's own letters. And the one pointed at in the + panel (invite.tsx), shown
// before any is added.
import type { Agent } from "../api/types.gen";

/** src: its picture; alt: the one to draw when that is not to be had. */
export type Fig = { key: string; src?: string; alt?: string; agent?: Agent };

let pointed: Fig | null = null;
/** The effort the flow is at its own speed for: high (kumo, 2026-11-25). */
export const STANDARD = 0.7;
let power = STANDARD;
const heard = new Set<() => void>();

/** The figure a row of the + panel stands for, as it is pointed at; null as the panel goes. */
export function point(f: Fig | null): void {
  if (pointed?.key === f?.key) return;
  pointed = f;
  power = STANDARD; // another one's effort is not this one's
  heard.forEach((h) => h());
}
export const pointedAt = () => pointed;
/** No longer pointed at, if it still is the one (a page of the panel gone as another came). */
export const unpoint = (key: string) => void (pointed?.key === key && point(null));
export const onPoint = (h: () => void) => (heard.add(h), () => void heard.delete(h));

/** The + panel gone: no row of it is pointed at, no effort of its menus is the flow's. The splash
 *  stays where it is whatever is open over it (kumo, 2026-11-25: it is not to move about). */
export function panelGone(): void {
  power = STANDARD;
  point(null);
}

// The effort slider's level (chat/effort.tsx), as it shows it and as it is moved: by the level's
// name, high the flow's own speed, the levels over it faster, those under it slower; the figure
// stands the stronger for it too. A level with a name not known here: by its place on the track.
const LEVELS: Record<string, number> = { off: 0.1, none: 0.1, minimal: 0.15, low: 0.3, medium: 0.5, high: STANDARD, xhigh: 0.85, max: 1, ultra: 1 };
export function effortAt(level: string, frac: number): void {
  const f = LEVELS[level] ?? frac;
  if (power === f) return;
  power = f;
  heard.forEach((h) => h());
}
export const powerNow = () => power;

// What the open channel says of itself (chat/channel/page.tsx): whether nothing is said in it
// yet, and its own figure. The pane has one splash, the same one with no channel open and in a
// channel with nothing said: going from one to the other it is not drawn anew (kumo, 2026-11-25).
export type Staged = { id: string; show: boolean; fig: Fig | null };
let staged: Staged | null = null;
export function stage(v: Staged): void {
  if (staged && staged.id === v.id && staged.show === v.show && (staged.fig?.key ?? "") === (v.fig?.key ?? "")) return;
  staged = v;
  heard.forEach((h) => h());
}
export const stagedNow = () => staged;
