// Unread (Rhodium spec web-maximize "未读和跑完提醒"; the count and 免打扰: the user, 2026-11-13):
// what was said in a session while its chat was not in front of you is counted till it is: a
// badge on its face in the list, and, for those not quiet, a count in the title and the app's
// badge. A turn this page saw end counts as one where nothing said was counted. In memory alone.
// The page shows no notification of its own: Web Push does, with the page open or not (the
// user, 2026-11-08).
//
// Quiet (免打扰): its badge is grey and it is left out of the title's count. A session another
// app or login opened is quiet unless said otherwise, yours is not; said in its menu, kept in
// this browser.
import { useSyncExternalStore } from "react";
import type { LastSaid, Me, Session } from "./api/types.gen";
import { route } from "./route";
import { keep, kept, lampOf } from "./ui";

export type Here = { chat: string; visible: boolean; focused: boolean };
const page = (): Here => {
  const r = route();
  return { chat: r.name === "chat" ? r.id : "", visible: document.visibilityState === "visible", focused: document.hasFocus() };
};

const unread = new Map<string, number>();
const quiet = new Set<string>();
const told = new Set<() => void>();
const changed = () => {
  let n = 0;
  for (const id of unread.keys()) if (!quiet.has(id)) n++;
  document.title = n ? `(${n}) Iridium` : "Iridium";
  (navigator as { setAppBadge?: (n: number) => Promise<void> }).setAppBadge?.(n).catch(() => {});
  told.forEach((f) => f());
};
const listen = (f: () => void) => (told.add(f), () => void told.delete(f));

/** How much of session id is unread: 0 none. */
export function useUnread(id: string): number {
  const get = () => unread.get(id) ?? 0;
  return useSyncExternalStore(listen, get, get);
}
export const unreadOf = (id: string) => unread.get(id) ?? 0;

/** Whether session id is quiet. */
export function useQuiet(id: string): boolean {
  const get = () => quiet.has(id);
  return useSyncExternalStore(listen, get, get);
}
export const isQuiet = (id: string) => quiet.has(id);

/** A count as a badge writes it: 99+ past 99. */
export const badge = (n: number) => (n > 99 ? "99+" : String(n));

// What was said of a session's quiet by hand: {id: true | false}.
const QUIET_KEY = "ir.quiet";
let said: Record<string, boolean> | undefined;
const hand = (): Record<string, boolean> => {
  if (!said) {
    try {
      said = JSON.parse(kept(QUIET_KEY) ?? "{}") as Record<string, boolean>;
    } catch {
      said = {};
    }
  }
  return said;
};

/** Makes session id quiet or not, whatever it would be by itself. */
export function setQuiet(id: string, on: boolean) {
  said = { ...hand(), [id]: on };
  keep(QUIET_KEY, JSON.stringify(said));
  if (on === quiet.has(id)) return;
  if (on) quiet.add(id);
  else quiet.delete(id);
  changed();
}

/** Whether s is another's: an app or login that is not me opened it, or the session it was
 *  started by (its launcher, a subagent's parent) is another's. One nobody opened through Iridium
 *  is not. */
export function anothers(s: Session, me: Pick<Me, "id">, by: Map<string, Session>): boolean {
  let x = s;
  for (let i = 0; i < 16; i++) {
    const up = by.get(x.launcher || x.parent || "");
    if (!up || up === x) break;
    x = up;
  }
  return !!x.opener && x.opener !== me.id;
}

const BUSY = new Set(["running", "compacting", "starting"]);

/** Whether what was last said is my own: typed by me, here or at another page of mine. */
const mine = (l: LastSaid, me: Pick<Me, "id">) => l.role === "user" && (!l.fromTerminal || l.fromTerminal === me.id);

/** Follows the list: what is said in a session (its last line moving on, not by me), or its turn
 *  ending with nothing counted, is unread unless its chat is in front of you. here: the page now.
 *  Returns what stops it. */
export function watchUnread(here: () => Here = page) {
  const states = new Map<string, string>();
  const ats = new Map<string, number>();
  const look = () => {
    const h = here();
    if (!h.visible || !h.chat) return;
    if (unread.delete(h.chat)) changed();
  };
  const take = (list: Session[], me: Pick<Me, "id"> = { id: "local" }) => {
    const h = here();
    const by = new Map(list.map((s) => [s.id, s]));
    const byHand = hand();
    let moved = false;
    for (const s of list) {
      const q = byHand[s.id] ?? anothers(s, me, by);
      if (q !== quiet.has(s.id)) {
        if (q) quiet.add(s.id);
        else quiet.delete(s.id);
        moved = true;
      }
      const was = states.get(s.id);
      const now = lampOf(s);
      states.set(s.id, now);
      const at = s.last?.at ?? 0;
      const wasAt = ats.get(s.id);
      ats.set(s.id, at);
      if (was === undefined) continue;
      const spoke = !!s.last && wasAt !== undefined && at > wasAt && !mine(s.last, me);
      const ended = was !== now && BUSY.has(was) && (now === "idle" || now === "error") && !unread.has(s.id);
      if (!(spoke || ended) || (h.visible && h.chat === s.id)) continue;
      unread.set(s.id, (unread.get(s.id) ?? 0) + 1);
      moved = true;
    }
    if (moved) changed();
  };
  for (const e of ["hashchange", "focus", "blur"]) addEventListener(e, look);
  document.addEventListener("visibilitychange", look);
  look();
  return {
    take,
    stop: () => {
      for (const e of ["hashchange", "focus", "blur"]) removeEventListener(e, look);
      document.removeEventListener("visibilitychange", look);
      unread.clear();
      quiet.clear();
    },
  };
}
