// An agent's work as one line under its message (src/chat/work.tsx; docs/next/ui.md §3 "在干活"):
// the same one line in every state, running, done, or as an older message says it; pressed, its
// steps open under it from the agent's record, and that is kept in this browser.
import { QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { queryClient, speakAs } from "../src/api/client";
import { t } from "../src/i18n";
import { isOpen, WorkLine } from "../src/chat/work";
import { collectSpans, resetSpans, restoreSpans } from "../src/chat/spans";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];
function draw(node: ReactNode): HTMLDivElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>));
  return host;
}
/** The line: the one row of a fixed height. */
const lineOf = (el: HTMLElement) => el.firstElementChild!.firstElementChild as HTMLElement;
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  vi.unstubAllGlobals();
  act(() => resetSpans());
  document.body.innerHTML = "";
});

test("one line of the same height running, done, and as an older message says it", () => {
  const running = draw(<WorkLine channel="c" n={1} session="c" work={{ steps: 3, running: true, tool: "Bash", from: 10 }} may />);
  const done = draw(<WorkLine channel="c" n={2} session="c" work={{ steps: 3, running: false, from: 10, to: 20, ms: 12_000 }} may />);
  const older = draw(<WorkLine channel="c" n={3} session="c" did={{ bash: 2, failed: 0, cmds: "go 2", read: 1, web: 0, agents: 0, other: 0, files: 0, add: 0, del: 0, paths: [] }} may />);
  for (const el of [running, done, older]) expect(lineOf(el).className).toContain("h-7 ");
  expect(running.textContent).toContain("Bash");
  expect(running.querySelectorAll("button")).toHaveLength(2); // the line, its stop key
  expect(done.textContent).not.toMatch(/步|step/i);
  expect(done.textContent).toContain(t("work.sec", { s: 12 }));
  expect(done.querySelectorAll("button")).toHaveLength(1);
  expect(older.textContent).toContain("bash 2");
  expect(older.querySelector("button")!.disabled).toBe(true); // nowhere in the record to read
});

test("pressed: its steps read from the record over the lines it spans, opened in place, kept open", async () => {
  speakAs("ir_web", "a");
  const asked: unknown[] = [];
  vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
    asked.push(JSON.parse(String(init.body)));
    const data = [
      { id: "10.0", content: '<iridium:tool name="Bash" id="t1"><iridium:input>{"command":"go test"}</iridium:input><iridium:result at="11.0">ok</iridium:result></iridium:tool>' },
      { id: "12.0", content: '<iridium:tool name="Read" id="t2"><iridium:input>{"file_path":"/a.go"}</iridium:input><iridium:result at="13.0">x</iridium:result></iridium:tool>' },
      { id: "20.0", content: '<iridium:tool name="Edit" id="t3"><iridium:input>{}</iridium:input></iridium:tool>' },
    ];
    return new Response(JSON.stringify({ data, _data: { start: 10, end: 30, more: false } }), { headers: { "content-type": "application/json" } });
  });
  const el = draw(<WorkLine channel="c2" n={5} session="s" work={{ steps: 2, running: false, from: 10, to: 20, ms: 900 }} may />);
  const key = el.querySelector("button")!;
  expect(key.getAttribute("aria-expanded")).toBe("false");
  await act(async () => key.click());
  await act(async () => {});
  expect(key.getAttribute("aria-expanded")).toBe("true");
  expect(isOpen("c2", 5)).toBe(true);
  expect(asked[0]).toMatchObject({ channel_id: "s", next: "10", direction: "after" });
  const rows = [...el.querySelectorAll("[aria-haspopup=dialog]")].map((b) => b.textContent);
  expect(rows).toHaveLength(2); // the call at line 20 is past the work's end
  expect(rows[0]).toContain("go test");
  expect(rows[1]).toContain("Read");
  // Two steps: the list two rows high, its key to put it away under it.
  expect(el.innerHTML).toContain("--rows: 2");
  await act(async () => key.click());
  expect(isOpen("c2", 5)).toBe(false);
});

test("single step: second press puts its card away instead of opening it again", async () => {
  speakAs("ir_web", "a");
  vi.stubGlobal("fetch", async () => {
    const data = [{ id: "10.0", content: '<iridium:tool name="Bash" id="t1"><iridium:input>{"command":"echo hi"}</iridium:input><iridium:result at="11.0">hi</iridium:result></iridium:tool>' }];
    return new Response(JSON.stringify({ data, _data: { start: 10, end: 12, more: false } }), { headers: { "content-type": "application/json" } });
  });
  const el = draw(<WorkLine channel="c3" n={1} session="s-one" work={{ steps: 1, running: false, from: 10, to: 12, ms: 500 }} may />);
  await act(async () => {});
  const key = el.querySelector("button")!;
  expect(key.getAttribute("aria-haspopup")).toBe("dialog");
  expect(key.getAttribute("aria-expanded")).toBe("false");
  // First click opens the card.
  await act(async () => {
    key.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    key.click();
  });
  expect(key.getAttribute("aria-expanded")).toBe("true");
  // Second press: document capture pointerdown runs before click; click must NOT re-open.
  await act(async () => {
    key.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await act(async () => {
    key.click();
  });
  expect(key.getAttribute("aria-expanded")).toBe("false");
  // Third press opens it again.
  await act(async () => {
    key.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    key.click();
  });
  expect(key.getAttribute("aria-expanded")).toBe("true");
});

test("step spans persist via collectSpans/restoreSpans and draw without refetching", async () => {
  speakAs("ir_web", "a");
  let fetches = 0;
  vi.stubGlobal("fetch", async () => {
    fetches++;
    const data = [
      { id: "10.0", content: '<iridium:tool name="Bash" id="t1"><iridium:input>{"command":"go test"}</iridium:input><iridium:result at="11.0">ok</iridium:result></iridium:tool>' },
      { id: "12.0", content: '<iridium:tool name="Read" id="t2"><iridium:input>{"file_path":"/a.go"}</iridium:input><iridium:result at="13.0">x</iridium:result></iridium:tool>' },
    ];
    return new Response(JSON.stringify({ data, _data: { start: 10, end: 14, more: false } }), { headers: { "content-type": "application/json" } });
  });
  draw(<WorkLine channel="c4" n={1} session="s-cache" work={{ steps: 2, running: false, from: 10, to: 14, ms: 900 }} may />);
  await act(async () => {});
  expect(fetches).toBe(1);
  const kept = collectSpans([{ author: { kind: "agent", session: "s-cache" }, work: { from: 10 } }]);
  expect(kept).toHaveLength(1);
  expect(kept[0]!.blocks).toHaveLength(2);

  // Simulate reload: clear memory, restore from device cache, render WorkLine — no fetch needed.
  act(() => {
    resetSpans();
    restoreSpans(kept);
  });
  const el = draw(<WorkLine channel="c4" n={1} session="s-cache" work={{ steps: 2, running: false, from: 10, to: 14, ms: 900 }} may />);
  await act(async () => {});
  expect(fetches).toBe(1);
  expect(el.textContent).toContain("Read");
});
