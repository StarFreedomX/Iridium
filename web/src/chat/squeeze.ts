// Pictures sent smaller (kumo, 2026-11-22: as QQ does, by default; 原图 sends them as they are): a
// still picture is drawn upright at a size a person and an agent both see it whole at, and encoded
// as WebP by libwebp (WebAssembly, in a worker: the page does not stop while it works). WebP, not
// AVIF: the file goes to the agent, and Claude, Codex and the server's thumbnails read WebP. GIFs
// and other moving pictures go as they are: drawn, they would keep one frame.
import { asWebp, KEEP, moving, squeezable } from "./squeeze-fit";
import type { Answer, Ask } from "./squeeze.worker";

let worker: Worker | null = null;
let next = 0;
const waiting = new Map<number, (a: Answer) => void>();

function ask(q: Omit<Ask, "id">): Promise<Answer> {
  if (!worker) {
    worker = new Worker(new URL("./squeeze.worker.ts", import.meta.url), { type: "module", name: "squeeze" });
    worker.onmessage = (e: MessageEvent<Answer>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    worker.onerror = () => {
      for (const done of waiting.values()) done({ id: -1, error: "worker" });
      waiting.clear();
      worker = null;
    };
  }
  const id = ++next;
  return new Promise((done) => {
    waiting.set(id, done);
    worker!.postMessage({ ...q, id } satisfies Ask);
  });
}

/** f smaller (a WebP named after it), or null where it goes as it is: not a still picture, small
 *  already, not made much smaller, or this browser cannot (no worker, no OffscreenCanvas). */
export async function squeeze(f: File): Promise<File | null> {
  if (!squeezable(f) || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  if ((f.type === "image/png" || f.type === "image/webp") && moving(new Uint8Array(await f.slice(0, 1 << 20).arrayBuffer()))) return null;
  const a = await ask({ file: f });
  if (!a.webp || a.webp.byteLength >= f.size * KEEP) return null;
  return new File([a.webp], asWebp(f.name), { type: "image/webp", lastModified: f.lastModified });
}
