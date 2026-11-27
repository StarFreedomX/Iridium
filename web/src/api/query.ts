// The page's queries: TanStack's useQuery and useQueries with one check (docs/前端设计规范.md
// "弹窗、页面打开时就是完整的"). What a popup draws (a menu, a popover, a card, the settings, a
// sheet's page: drawn under InPopup, which ui.tsx's surfaces set) is fetched before it opens. A
// query first drawn in a popup with no data yet, and no fetch of it out, would start its first
// fetch as the popup opens, and the popup would change as it comes: that is told, in development on
// the console, in tests as an error, in a built page only with window.__popcheck set
// (web/scripts/motion/pop.mjs); each one into window.__late. A query on what is picked or typed
// inside the popup says so with meta.inside, and its place in the popup is kept by design.
// Nothing else imports useQuery from TanStack (web/test/popdata.test.ts); useQueries is in
// api/queries.ts, apart: its code is the chat's alone.
import { useQuery as useQueryOf, useQueryClient, skipToken, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { createContext, use, useState } from "react";

/** Set by the shared popup surfaces (ui.tsx) round what is in them. */
export const InPopup = createContext(false);

export type Asked = { queryKey: QueryKey; queryFn?: unknown; enabled?: unknown; initialData?: unknown; placeholderData?: unknown; meta?: Record<string, unknown> };
const late = (globalThis as { __late?: string[] }).__late ?? [];
(globalThis as { __late?: string[] }).__late = late;

/** Whether a query is about to start its first fetch: no data, none in flight, nothing standing in
 *  for it, enabled. */
export function fetchesFirst(o: Asked, client: QueryClient): boolean {
  if (o.meta?.inside || o.enabled === false || o.queryFn === skipToken || o.initialData !== undefined || o.placeholderData !== undefined) return false;
  const q = client.getQueryCache().find({ queryKey: o.queryKey, exact: true });
  return !q || (q.state.data === undefined && q.state.fetchStatus !== "fetching");
}

function look(qs: Asked[], client: QueryClient) {
  const on = import.meta.env.DEV || (globalThis as { __popcheck?: boolean }).__popcheck;
  if (!on) return;
  for (const o of qs) {
    if (!fetchesFirst(o, client)) continue;
    const what = `drawn in a popup before its data, fetched as it opens: ${JSON.stringify(o.queryKey)}`;
    late.push(JSON.stringify(o.queryKey));
    if (import.meta.env.MODE === "test") throw new Error(what);
    console.error(what);
  }
}

/** As the first draw of a popup's content: its queries looked at once, as it mounts. */
export function useLook(qs: () => Asked[], client?: QueryClient) {
  const inside = use(InPopup);
  const c = useQueryClient(client);
  useState(() => inside && look(qs(), c));
}

export const useQuery = ((options: Asked, client?: QueryClient) => {
  useLook(() => [options], client);
  return useQueryOf(options as never, client);
}) as typeof useQueryOf;
