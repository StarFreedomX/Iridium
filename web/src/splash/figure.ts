// What the splash's characters draw (splash.tsx): a face (src), failing that its agent's mark,
// failing both Iridium's own letters. And the one pointed at in the + panel (invite.tsx), shown
// before any is added.
import type { Agent } from "../api/types.gen";

/** src: its picture; alt: the one to draw when that is not to be had. */
export type Fig = { key: string; src?: string; alt?: string; agent?: Agent };

let pointed: Fig | null = null;
const heard = new Set<() => void>();

/** The figure a row of the + panel stands for, as it is pointed at; null as the panel goes. */
export function point(f: Fig | null): void {
  if (pointed?.key === f?.key) return;
  pointed = f;
  heard.forEach((h) => h());
}
export const pointedAt = () => pointed;
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
  subs = 0;
  clearTimeout(later);
  tell(false);
}
export const panelOpen = () => open;
