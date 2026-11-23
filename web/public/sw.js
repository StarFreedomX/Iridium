// The page's worker: Web Push (plan "推送"), and the device's own cache of pictures (docs/plan.md
// "本机缓存"). Registered by every page that can (https, or localhost; src/device/boot.ts).

// ---- push ----

// A push shows a notification; tapping it opens the session's chat, in a page already open if
// there is one.
self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (_) {
    d = { title: e.data ? e.data.text() : "Iridium" };
  }
  e.waitUntil(self.registration.showNotification(d.title || "Iridium", { body: d.body || "", tag: d.session || undefined, data: { session: d.session || "" }, icon: "/favicon.svg" }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const session = (e.notification.data && e.notification.data.session) || "";
  const url = session ? `/#/s/${encodeURIComponent(session)}` : "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === location.origin && "focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// ---- the pictures kept on this device ----
//
// The faces, a session's pictures and the thumbnails of its files are answered from the cache
// first; one not there is fetched and kept (a 200 that may be stored, whole: no Range). Each kept
// is written down in the database with its kind, size and when it was last used; the page sweeps
// by those (src/device/store.ts, which has the same database and names). A 401 empties it all.

const IMAGES = "ir-images-1";
const DB = "ir-device";
const DB_VERSION = 1;
const STORES = ["entries", "conf", "chats"];

/** The kind of picture a path is ("face", "image"), or null: not kept. */
function category(path) {
  if (/^\/v1\/internal\/(channels|people|roles)\/[^/]+\/(avatar|background)$/.test(path) || /^\/_ir\/avatar\/[^/]+$/.test(path) || path === "/v1/internal/face") return "face";
  if (/^\/v1\/internal\/sessions\/[^/]+\/(image|files\/[^/]+\/thumb)$/.test(path)) return "image";
  return null;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET" || r.headers.has("range")) return;
  const url = new URL(r.url);
  if (url.origin !== location.origin) return;
  const cat = category(url.pathname);
  if (!cat) return;
  e.respondWith(serve(e, r, url.pathname + url.search, cat));
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "clear") e.waitUntil(clearAll());
});

async function serve(e, r, key, cat) {
  const c = await caches.open(IMAGES).catch(() => null);
  const hit = c && (await c.match(key).catch(() => undefined));
  if (hit) {
    e.waitUntil(touch(key));
    return hit;
  }
  const res = await fetch(r);
  if (res.status === 401) {
    e.waitUntil(clearAll());
    return res;
  }
  if (c && res.status === 200 && res.type === "basic" && !/no-store/i.test(res.headers.get("cache-control") || "")) e.waitUntil(keep(c, key, res.clone(), cat));
  return res;
}

let opened = null;
/** The database, made as the page makes it. */
function db() {
  return (opened ??= new Promise((resolve, reject) => {
    const q = indexedDB.open(DB, DB_VERSION);
    q.onupgradeneeded = () => {
      for (const s of STORES) if (!q.result.objectStoreNames.contains(s)) q.result.createObjectStore(s, { keyPath: "key" });
    };
    q.onsuccess = () => {
      q.result.onversionchange = () => (q.result.close(), (opened = null));
      resolve(q.result);
    };
    q.onerror = () => reject(q.error);
  }).catch((err) => ((opened = null), Promise.reject(err))));
}
const done = (t) => new Promise((resolve, reject) => ((t.oncomplete = () => resolve()), (t.onerror = t.onabort = () => reject(t.error))));

async function keep(c, key, res, cat) {
  try {
    const body = await res.blob();
    await c.put(key, new Response(body, { status: 200, headers: res.headers }));
    const t = (await db()).transaction("entries", "readwrite");
    t.objectStore("entries").put({ key, cat, size: body.size, used: Date.now() });
    await done(t);
  } catch (_) {}
}

// The uses written down together, a second after the first of them.
const used = new Set();
let flushing = null;
function touch(key) {
  used.add(key);
  return (flushing ??= new Promise((resolve) => setTimeout(resolve, 1000)).then(async () => {
    const keys = [...used];
    used.clear();
    flushing = null;
    try {
      const t = (await db()).transaction("entries", "readwrite");
      const s = t.objectStore("entries");
      const now = Date.now();
      for (const k of keys) {
        const q = s.get(k);
        q.onsuccess = () => q.result && s.put({ ...q.result, used: now });
      }
      await done(t);
    } catch (_) {}
  }));
}

/** Everything kept on this device let go: the pictures, the chats, what was written of them. */
async function clearAll() {
  try {
    await caches.delete(IMAGES);
  } catch (_) {}
  try {
    const t = (await db()).transaction(["entries", "chats"], "readwrite");
    t.objectStore("entries").clear();
    t.objectStore("chats").clear();
    await done(t);
  } catch (_) {}
}
