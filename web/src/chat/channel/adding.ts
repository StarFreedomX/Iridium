// A channel just made with no agent yet (create.tsx): the + beside its members' key opens on it
// by itself, once (top.tsx): adding its agents is what there is to do in it.
let asked: string | null = null;
const heard = new Set<() => void>();

/** The + of channel id is to open once its bar is drawn. */
export function askAdd(id: string): void {
  asked = id;
  heard.forEach((f) => f());
}

/** Whether channel id's + was asked to open: true once, then no more. */
export function takeAdd(id: string): boolean {
  if (asked !== id) return false;
  asked = null;
  return true;
}

/** Told as one is asked. Returns what stops it. */
export function onAskAdd(fn: () => void): () => void {
  heard.add(fn);
  return () => void heard.delete(fn);
}
