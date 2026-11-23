// The first screen from this device (docs/plan.md "本机缓存"; kumo, 2026-11-23: the faces came
// late at each start of the app, the cache there but unused): the carried states the sidebar is
// drawn from, kept here as the stream brings them and put back before the first frame, so a start
// draws the rows with their faces at once (their versions known, the pictures the cache's), not
// after the stream's four round trips. The stream's own replace them as they come. The sessions
// ("list", "guilds") only while chats are kept (the 缓存 page); the faces' versions always.
import { getCarried, onCarried, setCarried } from "../store";

const KEY = "ir-first";
const CHATS = "ir-first-chats";
const FACES = ["faces", "avatars"];
const ROWS = ["list", "guilds"];

const chatsKept = () => {
  try {
    return localStorage.getItem(CHATS) !== "0";
  } catch {
    return false;
  }
};

// The list as put back, till the stream's own takes its place.
let restored: unknown;
/** Whether the sessions' list is still this device's, not yet the server's: what reads a turn
 *  ending from it (unread, turns' ends, chats let go) waits for the server's. */
export const listFromDevice = () => restored !== undefined && getCarried("list") === restored;

/** Puts back what was kept, before the page is first drawn; a state already there is left. */
export function restore() {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, unknown> | null;
    if (!kept) return;
    for (const k of chatsKept() ? [...FACES, ...ROWS] : FACES) if (kept[k] !== undefined && getCarried(k) === undefined) setCarried(k, kept[k]);
    if (getCarried("list") === kept.list) restored = kept.list;
  } catch {
    // Not readable (private mode, a broken entry): drawn from the stream as before.
  }
}

let due: ReturnType<typeof setTimeout> | undefined;
// Let go (forgetFirst): nothing written again till the page is loaded anew.
let gone = false;
function save() {
  due = undefined;
  if (gone) return;
  const out: Record<string, unknown> = {};
  for (const k of chatsKept() ? [...FACES, ...ROWS] : FACES) {
    const v = getCarried(k);
    if (v !== undefined) out[k] = v;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    // Full or refused: the next start waits for the stream.
  }
}

/** Keeps them as they change: written a little after (not at each of a turn's many), and as the
 *  page hides. */
export function watch() {
  const keys = new Set([...FACES, ...ROWS]);
  onCarried((k) => {
    if (keys.has(k) && due === undefined) due = setTimeout(save, 2000);
  });
  addEventListener("pagehide", () => due !== undefined && (clearTimeout(due), save()));
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && due !== undefined && (clearTimeout(due), save()));
}

/** Whether the sessions are kept too (the 缓存 page's 在本机保存会话内容); off, they are let go. */
export function keepChats(on: boolean) {
  try {
    localStorage.setItem(CHATS, on ? "1" : "0");
  } catch {}
  save();
}

/** All of it let go (the login ended). */
export function forgetFirst() {
  gone = true;
  if (due !== undefined) clearTimeout(due), (due = undefined);
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
