// One page for a session, one agent or several: what of the channel's log goes where among the
// own agent's record (src/chat/channel/merge.ts).
import { describe, expect, test } from "vitest";
import type { ChannelMessage } from "../src/api/client";
import { msgOf, type Msg } from "../src/chat/channel/lib";
import { callerOf, foreignOf, held, HOLD, marksAt, ownAnchors, slotsOf } from "../src/chat/channel/merge";

const OWN = "own";
const said = (n: number, session: string, text = "hi", time = n * 10, data: ChannelMessage["_data"] = {}): Msg => msgOf({ id: String(n), content: text, user: { id: `agent:${session}`, name: "Claude", nick: session }, created_at: time, _data: { session, ...data } })!;
const person = (n: number, text = "hi", input?: string, time = n * 10): Msg => msgOf({ id: String(n), content: text, user: { id: "ir_web/k", name: "kumo" }, created_at: time, _data: input ? { input } : {} })!;
const note = (n: number, time = n * 10): Msg => msgOf({ id: String(n), content: "x joined", user: { id: "iridium", name: "Iridium" }, created_at: time })!;

describe("what of the log the record does not hold", () => {
  test("not the own agent's words, nor a person's it was given; others', a person's to another, Iridium's lines", () => {
    const ms = [person(1, "to all", "in1"), said(2, OWN), said(3, "codex"), person(4, "@codex only", "in2"), note(5)];
    expect(foreignOf(ms, OWN, new Set(["in1"])).map((m) => m.n)).toEqual([3, 4, 5]);
  });
  test("a person's read from a record (no input) is the record's too", () => {
    const typed = msgOf({ id: "1", content: "typed", user: { id: "terminal", name: "t" }, created_at: 1, _data: {} })!;
    expect(typed.input).toBeUndefined();
    expect(foreignOf([typed], OWN, new Set())).toEqual([]);
  });
  test("since: none older than the record's first block loaded", () => {
    expect(foreignOf([said(1, "codex"), said(2, "codex")], OWN, new Set(), 15).map((m) => m.n)).toEqual([2]);
  });
});

describe("in its place by time", () => {
  test("before the first row later than it; after them all when none is", () => {
    const slots = slotsOf([10, 20, 30], [{ time: 15 }, { time: 16 }, { time: 40 }]);
    expect([...slots.entries()].map(([i, ms]) => [i, ms.map((m) => m.time)])).toEqual([
      [1, [15, 16]],
      [3, [40]],
    ]);
  });
  test("a row with no time is as the one before it; what is being written stays last", () => {
    const slots = slotsOf([10, undefined, Infinity], [{ time: 12 }]);
    expect([...slots.keys()]).toEqual([2]);
    expect([...slotsOf([undefined, 5], [{ time: 1 }]).keys()]).toEqual([1]);
  });
  test("one at the same time as a row goes after it", () => {
    expect([...slotsOf([10, 20], [{ time: 10 }]).keys()]).toEqual([1]);
  });
});

describe("read marks among both", () => {
  test("own words by their block, a person's by its input, others' by their own rows", () => {
    const ms = [person(1, "go", "in1"), said(2, OWN, "ok", 20, { block: "7.0" }), said(3, "codex")];
    const anchors = [...ownAnchors(ms, OWN, [{ key: "5.0", line: 5, id: "in1" }, { key: "7.0", line: 7 }]), { key: "ch:3", seq: 3 }];
    expect(anchors).toEqual([
      { key: "5.0", seq: 1 },
      { key: "7.0", seq: 2 },
      { key: "ch:3", seq: 3 },
    ]);
    const marks = marksAt(anchors, [
      { member: "a", seq: 2 },
      { member: "b", seq: 9 },
      { member: "me", seq: 3 },
      { member: "c", seq: 0 },
    ], "me");
    expect(Object.fromEntries([...marks].map(([k, rs]) => [k, rs.map((r) => r.member)]))).toEqual({ "7.0": ["a"], "ch:3": ["b"] });
  });
  test("a stretch's words by the last row before where it ends", () => {
    expect(ownAnchors([said(4, OWN, "x", 40, { from: 3, to: 9 })], OWN, [{ key: "3.0", line: 3 }, { key: "8.1", line: 8 }, { key: "9.0", line: 9 }])).toEqual([{ key: "8.1", seq: 4 }]);
  });
});

describe("the hand-over", () => {
  test("held while the words calling it are not shown, or the own agent still writes them", () => {
    const h = { since: 1000, called: 7 };
    expect(held(h, () => false, false, 1200)).toBe(true);
    expect(held(h, (n) => n === 7, false, 1200)).toBe(false);
    expect(held(h, (n) => n === 7, true, 1200)).toBe(true);
    expect(held({ since: 1000 }, () => false, false, 1200)).toBe(false);
  });
  test("never longer than HOLD", () => {
    expect(held({ since: 1000, called: 7 }, () => false, true, 1000 + HOLD)).toBe(false);
  });
  test("the caller: the latest naming @nick by another, standing by itself", () => {
    const ms = [person(1, "@codex test it"), said(2, "codex", "@codex is me"), said(3, OWN, "done, @codex run the tests"), said(4, OWN, "email a@codexs.com")];
    expect(callerOf(ms, "codex", "codex")).toBe(3);
    expect(callerOf(ms, "pi", "pi")).toBeUndefined();
    expect(callerOf([person(1, "@codex2 go")], "codex", "codex")).toBeUndefined();
  });
});
