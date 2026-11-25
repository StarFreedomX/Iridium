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

// The + panel open: the figure stands left of it and of the menu beside its rows, not under them.
let open = false;
export function panel(o: boolean): void {
  if (open === o) return;
  open = o;
  heard.forEach((h) => h());
}
export const panelOpen = () => open;
