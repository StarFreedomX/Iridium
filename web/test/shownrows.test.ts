// What is shown never changes places (docs/动画.md "画出来的不换位"): a message sent stays where
// its bubble was, whatever the channel was given before the server had it.
import { expect, test } from "vitest";
import { shownRows, type Msg } from "../src/chat/channel/lib";

const msg = (n: number) => ({ n, text: `m${n}`, author: { kind: "iridium" } }) as unknown as Msg;
const flat = (rows: ReturnType<typeof shownRows<{ key: string; place?: number }>>) => rows.map((r) => ("sent" in r ? r.sent.key : r.msgs.map((m) => m.n).join(","))).join(" | ");

test("a bubble waits under what the page had, over what came after it", () => {
  // Sent after #2; #3 (an agent's line) came before the server had it.
  expect(flat(shownRows([1, 2, 3].map(msg), new Map(), [{ key: "x", place: 2.5 }]))).toBe("1,2 | x | 3");
});

test("come as #4, it stays over #3", () => {
  expect(flat(shownRows([1, 2, 3, 4].map(msg), new Map([[4, 2.5]]), []))).toBe("1,2,4,3");
});

test("two sent in a row keep their order; one with no place is last", () => {
  expect(flat(shownRows([1, 2, 3].map(msg), new Map(), [{ key: "a", place: 2.5 }, { key: "b", place: 2.6 }, { key: "c" }]))).toBe("1,2 | a | b | 3 | c");
});

test("nothing sent: the log as it is", () => {
  expect(flat(shownRows([1, 2, 3].map(msg), new Map(), []))).toBe("1,2,3");
});
