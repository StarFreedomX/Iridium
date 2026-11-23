// What this device keeps of this Iridium (docs/plan.md "本机缓存"): the pictures the worker keeps
// (public/sw.js: faces, a session's pictures, thumbnails) and the chats' latest pages (chats.ts),
// each written down in one database with its kind, size and last use. Swept by how long since it
// was used and by the whole's size, at start and once a day; let go whole as the login ends.
// Loaded after the first screen, never in it.

/** The database and its stores, as public/sw.js has them. */
export const DB = "ir-device";
export const DB_VERSION = 1;
export const STORES = ["entries", "conf", "chats"] as const;
/** The worker's cache of pictures. */
export const IMAGES = "ir-images-1";

export type Cat = "image" | "face" | "chat";
export const CATS: Cat[] = ["image", "face", "chat"];
/** One thing kept: a picture's address, or "chat:<id>"; its size in bytes; when last used (ms). */
export interface Entry {
  key: string;
  cat: Cat;
  size: number;
  used: number;
}
/** How long a thing unused is kept (days), how much is kept at most (MB), whether chats are. */
export interface Conf {
  days: number;
  capMB: number;
  chats: boolean;
}
export const DEFAULTS: Conf = { days: 7, capMB: 200, chats: true };
const DAY = 86_400_000;

/** What a sweep lets go, by key: what was not used for conf.days, then the least lately used till
 *  the rest is within conf.capMB. */
export function plan(entries: Entry[], now: number, conf: Conf): string[] {
  const gone: string[] = [];
  const left: Entry[] = [];
  for (const e of entries) {
    if (now - e.used > conf.days * DAY) gone.push(e.key);
    else left.push(e);
  }
  let total = left.reduce((n, e) => n + e.size, 0);
  const cap = conf.capMB * 1024 * 1024;
  left.sort((a, b) => a.used - b.used);
  for (const e of left) {
    if (total <= cap) break;
    gone.push(e.key);
    total -= e.size;
  }
  return gone;
}

let opened: Promise<IDBDatabase> | null = null;
/** The database; null where there is none (a private window, an old browser). */
export async function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const q = indexedDB.open(DB, DB_VERSION);
    q.onupgradeneeded = () => {
      for (const s of STORES) if (!q.result.objectStoreNames.contains(s)) q.result.createObjectStore(s, { keyPath: "key" });
    };
    q.onsuccess = () => {
      q.result.onversionchange = () => (q.result.close(), (opened = null));
      resolve(q.result);
    };
    q.onerror = () => reject(q.error);
  }).catch((err) => ((opened = null), Promise.reject(err)));
  return opened.catch(() => null);
}

export const asked = <T>(q: IDBRequest<T>) => new Promise<T>((resolve, reject) => ((q.onsuccess = () => resolve(q.result)), (q.onerror = () => reject(q.error))));
export const done = (t: IDBTransaction) => new Promise<void>((resolve, reject) => ((t.oncomplete = () => resolve()), (t.onerror = t.onabort = () => reject(t.error))));

/** Everything written down. */
export async function entries(): Promise<Entry[]> {
  const d = await db();
  if (!d) return [];
  return asked(d.transaction("entries").objectStore("entries").getAll() as IDBRequest<Entry[]>).catch(() => []);
}

export type Usage = Record<Cat, { n: number; bytes: number }>;
/** How many of each kind are kept, and their bytes. */
export function usageOf(es: Entry[]): Usage {
  const u = { image: { n: 0, bytes: 0 }, face: { n: 0, bytes: 0 }, chat: { n: 0, bytes: 0 } };
  for (const e of es) {
    const c = u[e.cat];
    if (!c) continue;
    c.n++;
    c.bytes += e.size;
  }
  return u;
}

export async function getConf(): Promise<Conf> {
  const d = await db();
  if (!d) return DEFAULTS;
  const c = await asked(d.transaction("conf").objectStore("conf").get("conf") as IDBRequest<(Partial<Conf> & { key: string }) | undefined>).catch(() => undefined);
  return { days: c?.days ?? DEFAULTS.days, capMB: c?.capMB ?? DEFAULTS.capMB, chats: c?.chats ?? DEFAULTS.chats };
}

export async function setConf(c: Conf) {
  const d = await db();
  if (!d) return;
  const t = d.transaction("conf", "readwrite");
  t.objectStore("conf").put({ key: "conf", ...c });
  await done(t);
}

/** Lets go of the things under keys: their pictures, their chats, what was written of them. */
export async function drop(keys: string[]) {
  if (!keys.length) return;
  const d = await db();
  const pics = keys.filter((k) => !k.startsWith("chat:"));
  if (pics.length && typeof caches !== "undefined") {
    const c = await caches.open(IMAGES).catch(() => null);
    if (c) await Promise.all(pics.map((k) => c.delete(k).catch(() => false)));
  }
  if (!d) return;
  const t = d.transaction(["entries", "chats"], "readwrite");
  for (const k of keys) {
    t.objectStore("entries").delete(k);
    if (k.startsWith("chat:")) t.objectStore("chats").delete(k);
  }
  await done(t).catch(() => {});
}

/** Lets go of everything of kind cat, or of every kind. */
export async function clear(cat?: Cat) {
  if (!cat) {
    if (typeof caches !== "undefined") await caches.delete(IMAGES).catch(() => false);
    const d = await db();
    if (!d) return;
    const t = d.transaction(["entries", "chats"], "readwrite");
    t.objectStore("entries").clear();
    t.objectStore("chats").clear();
    return done(t).catch(() => {});
  }
  await drop((await entries()).filter((e) => e.cat === cat).map((e) => e.key));
}

const SWEPT = "ir.device.swept";
/** Sweeps by the rules (plan) now. */
export async function sweep(now = Date.now()) {
  const [es, conf] = await Promise.all([entries(), getConf()]);
  await drop(plan(es, now, conf));
  try {
    localStorage.setItem(SWEPT, String(now));
  } catch {}
}
/** Sweeps if a day has gone since the last sweep, or at once with force (the start). */
export async function sweepDue(force = false) {
  let last = 0;
  try {
    last = Number(localStorage.getItem(SWEPT)) || 0;
  } catch {}
  if (force || Date.now() - last >= DAY) await sweep();
}
