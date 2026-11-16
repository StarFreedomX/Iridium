// Unread counts and 免打扰 (src/unread.ts): what is said off screen is counted, yours is not;
// another's session is quiet unless said otherwise.
import { afterEach, expect, test } from "vitest";
import type { Session } from "../src/api/types.gen";
import { setCarried } from "../src/store";
import { anothers, atOf, attention, badge, isQuiet, setQuiet, unreadOf, watchUnread } from "../src/unread";

const s = (id: string, more: Partial<Session> = {}): Session => ({ id, agent: "claude", cwd: "/w", status: "idle", hosted: true, live: true, updatedAt: 1, ...more });
const me = { id: "web/kumo" };
let w: ReturnType<typeof watchUnread> | undefined;
afterEach(() => (w?.stop(), localStorage.clear(), setCarried("ats", null)));

test("what is said off screen is counted, a turn's end once, yours never", () => {
  let chat = "b";
  w = watchUnread(() => ({ chat, visible: true, focused: true }));
  w.take([s("a", { status: "running", last: { role: "user", text: "go", at: 1 } }), s("b")], me);
  expect(unreadOf("a")).toBe(0);
  w.take([s("a", { status: "running", last: { role: "assistant", text: "one", at: 2 } }), s("b")], me);
  w.take([s("a", { status: "running", last: { role: "assistant", text: "two", at: 3 } }), s("b")], me);
  expect(unreadOf("a")).toBe(2);
  // The turn ends: already counted.
  w.take([s("a", { last: { role: "assistant", text: "two", at: 3 } }), s("b")], me);
  expect(unreadOf("a")).toBe(2);
  // Mine, from another page of mine: not counted. Another login's: counted.
  w.take([s("a", { last: { role: "user", text: "hi", at: 4, fromTerminal: "web/kumo" } }), s("b")], me);
  expect(unreadOf("a")).toBe(2);
  w.take([s("a", { last: { role: "user", text: "hi", at: 5, fromTerminal: "web/otae" } }), s("b")], me);
  expect(unreadOf("a")).toBe(3);
  // In front of you: not counted, and a look clears it.
  chat = "a";
  w.take([s("a", { last: { role: "assistant", text: "three", at: 6 } }), s("b")], me);
  expect(unreadOf("a")).toBe(3);
  dispatchEvent(new Event("focus"));
  expect(unreadOf("a")).toBe(0);
  // A turn that ends with nothing said counts as one.
  w.take([s("a"), s("b", { status: "running" })], me);
  w.take([s("a"), s("b")], me);
  expect(unreadOf("b")).toBe(1);
});

test("another's session is quiet, yours is not; the menu's word is kept", () => {
  const list = [s("mine", { opener: "web/kumo" }), s("theirs", { opener: "web/otae" }), s("child", { launcher: "theirs", opener: "web/kumo" }), s("found")];
  const by = new Map(list.map((x) => [x.id, x]));
  expect(list.map((x) => anothers(x, me, by))).toEqual([false, true, true, false]);
  w = watchUnread(() => ({ chat: "", visible: true, focused: true }));
  w.take(list, me);
  expect([isQuiet("mine"), isQuiet("theirs")]).toEqual([false, true]);
  setQuiet("theirs", false);
  setQuiet("mine", true);
  w.take(list, me);
  expect([isQuiet("mine"), isQuiet("theirs")]).toEqual([true, false]);
  // The title counts only those not quiet.
  w.take(list.map((x) => ({ ...x, last: { role: "assistant", text: "x", at: 9 } })), me);
  expect(document.title).toBe("(2) Iridium");
});

test("kept over a reload; said while no page was open counts one; a channel it is in is in front", () => {
  w = watchUnread(() => ({ chat: "", visible: true, focused: true }));
  w.take([s("a", { last: { role: "assistant", text: "x", at: 1 } }), s("b", { last: { role: "assistant", text: "x", at: 1 } })], me);
  w.take([s("a", { last: { role: "assistant", text: "y", at: 2 } }), s("b", { last: { role: "assistant", text: "x", at: 1 } })], me);
  expect(unreadOf("a")).toBe(1);
  w.stop();
  expect(unreadOf("a")).toBe(0);
  // Loaded again: a's count is back; b spoke meanwhile.
  let chat = "";
  w = watchUnread(() => ({ chat, visible: true, focused: true }));
  expect(unreadOf("a")).toBe(1);
  w.take([s("a", { last: { role: "assistant", text: "y", at: 2 } }), s("b", { in: ["room"], last: { role: "assistant", text: "z", at: 5 } })], me);
  expect([unreadOf("a"), unreadOf("b")]).toEqual([1, 1]);
  // The channel b is in comes to the front: read. What it says while it is there is not counted.
  chat = "room";
  dispatchEvent(new Event("focus"));
  expect([unreadOf("a"), unreadOf("b")]).toEqual([1, 0]);
  w.take([s("a", { last: { role: "assistant", text: "y", at: 2 } }), s("b", { in: ["room"], last: { role: "assistant", text: "z", at: 6 } })], me);
  expect(unreadOf("b")).toBe(0);
});

test("a badge stops at 99+", () => {
  expect([badge(1), badge(99), badge(100)]).toEqual(["1", "99", "99+"]);
});

test("a channel that names me counts though it is quiet, and the chat in front has read it", () => {
  let chat = "";
  const read: [string, number][] = [];
  w = watchUnread(() => ({ chat, visible: true, focused: true }), (id, seq) => (read.push([id, seq]), Promise.resolve()));
  const list = [s("mine", { opener: "web/kumo" }), s("hers", { opener: "web/otae" }), s("gone", { archived: true })];
  w.take(list, me);
  expect(attention()).toBe(0);
  // Quiet and named: counted, with or without a count of its own; one with no row is not.
  setCarried("ats", { hers: { seq: 7, everyone: true }, gone: { seq: 2 } });
  expect(atOf("hers")).toEqual({ seq: 7, everyone: true });
  expect(attention()).toBe(1);
  w.take([list[0]!, s("hers", { opener: "web/otae", last: { role: "assistant", text: "@全体成员", at: 5 } }), list[2]!], me);
  expect([unreadOf("hers"), isQuiet("hers"), attention()]).toEqual([1, true, 1]);
  expect(read).toEqual([]);
  // Opened: read up to the message that names me, said once.
  chat = "hers";
  dispatchEvent(new Event("focus"));
  dispatchEvent(new Event("focus"));
  expect(read).toEqual([["hers", 7]]);
  // The daemon takes the mark away.
  setCarried("ats", { gone: { seq: 2 } });
  expect([atOf("hers"), attention()]).toEqual([undefined, 0]);
});

test("a chat opened by go is read at once (kumo, 2026-11-16: the badge stayed)", async () => {
  const { go } = await import("../src/route");
  go({ name: "home" });
  w = watchUnread();
  w.take([s("a", { last: { role: "assistant", text: "x", at: 1 } })], me);
  w.take([s("a", { last: { role: "assistant", text: "y", at: 2 } })], me);
  expect(unreadOf("a")).toBe(1);
  go({ name: "chat", id: "a" });
  expect(unreadOf("a")).toBe(0);
  go({ name: "home" });
});
