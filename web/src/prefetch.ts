// Fetching ahead (plan "弱网"): once the page is idle, the files of the later parts (the chat, the
// settings, the jump box…) the first screen did not load, one at a time at low priority, as the HTML's
// <meta name="later"> lists them (vite.config.ts); then their code runs from the cache (app.tsx). Nothing while the browser saves data.
import { lazy, useEffect, useRef, type ComponentType } from "react";
import { queryClient, request } from "./api/client";
import { mayPrefetch } from "./chats";

let idle: Promise<void> | undefined;
/** Resolves once the page has loaded, no answer is out and the browser is idle. */
export const settled = () =>
  (idle ??= new Promise<void>((resolve) => {
    const look = () => {
      if (document.readyState !== "complete" || queryClient.isFetching()) return void setTimeout(look, 200);
      if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: 2_000 });
      else setTimeout(resolve, 200);
    };
    look();
  }));

/** Fetches the later files into the browser's cache; says whether every one came. */
export async function prefetch(): Promise<boolean> {
  const files = document.querySelector<HTMLMetaElement>('meta[name="later"]')?.content.split(" ").filter(Boolean) ?? [];
  await settled();
  let all = true;
  for (const f of files) {
    while (queryClient.isFetching()) await new Promise((r) => setTimeout(r, 500));
    if (!mayPrefetch()) return false;
    const came = await request(f, { priority: "low" } as RequestInit)
      .then(async (r) => (await r.blob(), r.ok))
      .catch(() => false);
    all &&= came;
  }
  return all;
}

/** The props of a key that opens a popup or a page: what it will draw fetched ahead
 *  (docs/前端设计规范.md "弹窗、页面打开时就是完整的") as the key is pointed at, pressed or
 *  focused. get starts the fetches (prefetchQuery: nothing again while what it has is fresh). */
export const ahead = (get: () => void) => ({ onPointerEnter: get, onPointerDown: get, onFocus: get });

/** ahead, and once the page is idle after the key is drawn (a card's keys as the card opens).
 *  deps: when to again. */
export function useAhead(get: (() => void) | undefined, deps: unknown[]) {
  const now = useRef(get);
  now.current = get;
  useEffect(() => {
    if (!now.current) return;
    let on = true;
    let id = 0;
    void settled().then(() => {
      if (!on) return;
      const run = () => on && now.current?.();
      id = typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout: 1_000 }) : window.setTimeout(run, 100);
    });
    return () => {
      on = false;
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(id);
      else clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return get ? ahead(() => now.current?.()) : {};
}

/** A part of the page loaded as it is first drawn (React.lazy), whose code may be asked for ahead
 *  (lazy.ahead(): idle, a key pointed at): once come, it is drawn at once, in a popup's first frame,
 *  not its Suspense fallback first. ahead starts React's own load of it (its _init; React 19.3). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyAhead<T extends ComponentType<any>>(load: () => Promise<T>) {
  const part = lazy(() => load().then((c) => ({ default: c })));
  const inner = part as unknown as { _init: (p: unknown) => unknown; _payload: unknown };
  const ahead = () => {
    try {
      inner._init(inner._payload);
    } catch {
      // Not come yet: it is on its way.
    }
  };
  return Object.assign(part, { ahead });
}
