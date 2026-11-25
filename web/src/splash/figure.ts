// What the splash's characters draw (splash.tsx): a face (src), failing that its agent's mark,
// failing both Iridium's own letters. And the one pointed at in the + panel (invite.tsx), shown
// before any is added.
import type { Agent } from "../api/types.gen";

/** src: its picture; alt: the one to draw when that is not to be had. */
export type Fig = { key: string; src?: string; alt?: string; agent?: Agent };

let pointed: Fig | null = null;
let power = 0.5;
const heard = new Set<() => void>();

/** The figure a row of the + panel stands for, as it is pointed at; null as the panel goes. */
export function point(f: Fig | null): void {
  if (pointed?.key === f?.key) return;
  pointed = f;
  power = 0.5; // another one's effort is not this one's
  heard.forEach((h) => h());
}
export const pointedAt = () => pointed;
/** No longer pointed at, if it still is the one (a page of the panel gone as another came). */
export const unpoint = (key: string) => void (pointed?.key === key && point(null));
export const onPoint = (h: () => void) => (heard.add(h), () => void heard.delete(h));

// A menu open beside a row of the + panel (a kind's models, a template's card): the figure stands
// left of the two, not under them. The panel alone leaves the middle free (kumo, 2026-11-25).
// One row's menu shut as the next one's opens is no return to the middle between them.
let subs = 0, open = false, later = 0;
const tell = (o: boolean) => {
  if (open === o) return;
  open = o;
  heard.forEach((h) => h());
};
/** A row's menu opened or shut. */
export function beside(o: boolean): void {
  subs = Math.max(0, subs + (o ? 1 : -1));
  clearTimeout(later);
  if (subs) tell(true);
  else later = window.setTimeout(() => tell(false), 250);
}
/** The panel gone, its menus with it. */
export function panelGone(): void {
  up = false;
  power = 0.5;
  subs = 0;
  clearTimeout(later);
  tell(false);
}
export const panelOpen = () => open;

// The effort slider's level as it is moved (chat/effort.tsx), 0 to 1: the code flows the faster
// and the figure stands the stronger for it. 0.5 with none moved.
export function effortAt(f: number): void {
  if (power === f) return;
  power = f;
  heard.forEach((h) => h());
}
export const powerNow = () => power;

// The + panel there at all: in the portrait layout it takes the pane's upper part, and the band
// goes down to what is left under it.
let up = false;
export function panelUp(): void {
  if (up) return;
  up = true;
  heard.forEach((h) => h());
}
export const panelIsUp = () => up;

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
