// A popup whole as it opens (docs/前端设计规范.md "弹窗、页面打开时就是完整的"): what it draws is
// fetched before it opens, never on its first draw. Every popup goes through ui.tsx's portals (or
// OwnPopup), which say so to what is in it (api/query.ts InPopup); every query goes through
// api/query.ts, which tells one first drawn in a popup with no data yet, nor any on its way.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { InPopup, useQuery } from "../src/api/query";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = join(import.meta.dirname, "../src");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.tsx?$/.test(f) ? [join(dir, f)] : []));
const using = (re: RegExp) =>
  files(src)
    .filter((f) => re.test(readFileSync(f, "utf8")))
    .map((f) => relative(src, f))
    .sort();

test("every popup through ui.tsx's portals, which tell what is in them it is a popup's", () => {
  expect(using(/<(Menu|Popover|Dialog|Select|Tooltip|PreviewCard|ContextMenu|AlertDialog|Drawer|NavigationMenu|Combobox|Autocomplete)\.Portal\b/)).toEqual([]);
  expect(using(/\.Portal\)/)).toEqual(["choose.tsx", "ui.tsx"]); // popupPortal(X.Portal)
});

test("every query through api/query.ts", () => {
  const re = /import\s*\{[^}]*\b(useQuery|useQueries|useSuspenseQuery|useSuspenseQueries|useInfiniteQuery)\b[^}]*\}\s*from\s*"@tanstack\/react-query"/;
  expect(using(re)).toEqual(["api/queries.ts", "api/query.ts"]);
});

function Asks({ meta }: { meta?: Record<string, unknown> }) {
  const q = useQuery({ queryKey: ["popdata", "x"], queryFn: () => new Promise<string>(() => {}), meta });
  return q.data ?? "…";
}

function draw(node: ReactNode, client: QueryClient) {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(QueryClientProvider, { client }, node)));
  return () => act(() => root.unmount());
}

test("a query first drawn in a popup with no data and none on its way is told", () => {
  const client = new QueryClient();
  const errors: unknown[] = [];
  const was = console.error;
  console.error = () => {};
  addEventListener("error", (e) => (errors.push(e.error), e.preventDefault()), { once: true });
  try {
    expect(() => draw(createElement(InPopup, { value: true }, createElement(Asks)), client)).toThrow(/drawn in a popup before its data/);
  } finally {
    console.error = was;
  }
});

test("fetched ahead, outside a popup, or asked for by what is picked in it: nothing told", () => {
  // Outside a popup.
  draw(createElement(Asks), new QueryClient())();
  // Its data there before it opens.
  const ahead = new QueryClient();
  ahead.setQueryData(["popdata", "x"], "x");
  draw(createElement(InPopup, { value: true }, createElement(Asks)), ahead)();
  // On its way (pressed: fetched as the key was pointed at).
  const coming = new QueryClient();
  void coming.prefetchQuery({ queryKey: ["popdata", "x"], queryFn: () => new Promise<string>(() => {}) });
  draw(createElement(InPopup, { value: true }, createElement(Asks)), coming)();
  // On what is typed or picked inside it, its place kept by design.
  draw(createElement(InPopup, { value: true }, createElement(Asks, { meta: { inside: true } })), new QueryClient())();
});
