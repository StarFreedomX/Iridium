// The conversation's one table (docs/next/ui.md §3 "行表"; src/chat/channel/log.ts, rows.ts): what
// the events, the log's pages and this page's own bubbles make of the rows, in what order, under
// which heads. The same events always give the same rows.
import { describe, expect, test } from "vitest";
import type { ChannelMessage, ChannelPage } from "../src/api/client";
import type { Sent } from "../src/chats";
import { msgOf, workIn } from "../src/chat/channel/lib";
import { ChannelLog } from "../src/chat/channel/log";
import { doneBefore, grouped, ordered } from "../src/chat/channel/rows";

const agent = (n: number, session: string, content = "hi", data: ChannelMessage["_data"] = {}): ChannelMessage => ({ id: String(n), content, user: { id: `agent:${session}`, name: "pi", nick: session, is_bot: true }, created_at: n, _data: { session, ...data } });
const person = (n: number, content = "hi", input?: string, id = "me"): ChannelMessage => ({ id: String(n), content, user: { id, name: id }, created_at: n, ...(input ? { _data: { input } } : {}) });
const sent = (key: string, text = "hi", more: Partial<Sent> = {}): Sent => ({ key, text, files: [], from: 0, input: `in-${key}`, ...more });

/** A log over all (a server's), its readings counted. */
function server(all: ChannelMessage[]) {
  const asked: { before?: number; after?: number }[] = [];
  const get = async (_: string, q: { before?: number; after?: number }): Promise<ChannelPage> => {
    asked.push(q);
    const n = (m: ChannelMessage) => Number(m.id);
    const data = q.after !== undefined ? all.filter((m) => n(m) > q.after!) : all.filter((m) => q.before === undefined || n(m) < q.before);
    return { data, start: n(data[0] ?? { id: "0", content: "" }), end: n(data.at(-1) ?? { id: "0", content: "" }), more: false };
  };
  return { asked, log: new ChannelLog("c", get) };
}
const mine = (a: { id: string }) => a.id === "me";
/** The rows as drawn: a group a "|"; a message its number, a bubble its key. */
const drawn = (log: ChannelLog) =>
  log
    .groups(mine)
    .map((g) => g.lines.map((l) => (l.m ? String(l.m.n) : `(${l.sent.key})`)).join(","))
    .join(" | ");

describe("events", () => {
  test("the same message told twice is one row; a second made is no change", async () => {
    const { log, asked } = server([person(1)]);
    await log.newer();
    log.heard(agent(2, "a", "one"));
    const v = log.version;
    log.heard(agent(2, "a", "one"));
    log.heard(agent(2, "a", "other words"), "message-created");
    expect(log.version).toBe(v);
    expect(log.msgs.map((m) => [m.n, m.text])).toEqual([
      [1, "hi"],
      [2, "one"],
    ]);
    expect(asked).toHaveLength(1);
  });

  test("changed before it was made: put in, and the made that comes after takes nothing back", async () => {
    const { log } = server([person(1)]);
    await log.newer();
    log.heard(agent(2, "a", "I will look.", { writing: true }), "message-updated");
    log.heard(agent(2, "a", "I will", { writing: true }), "message-created");
    expect(log.msgs.at(-1)).toMatchObject({ n: 2, text: "I will look.", writing: true });
  });

  test("one further on than the next number: those between are read", async () => {
    const all = [person(1)];
    const { log, asked } = server(all);
    await log.newer();
    all.push(person(2), agent(3, "a", "I will", { writing: true }));
    log.heard(agent(3, "a", "I will", { writing: true }));
    await log.newer();
    expect(asked).toContainEqual({ after: 1 });
    expect(log.msgs.map((m) => m.n)).toEqual([1, 2, 3]);
  });

  test("a reading asked for before an event told of a message does not undo it", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const stale = [person(1), agent(2, "a", "I", { writing: true })];
    const log = new ChannelLog("c", async (_, q) => {
      await gate;
      const data = stale.filter((m) => Number(m.id) > (q.after ?? 0));
      return { data, start: 1, end: 2, more: false };
    });
    log.restore([msgOf(person(1))!], false);
    log.take({ data: [person(1)], start: 1, end: 1, more: false });
    const reading = log.newer();
    log.heard(agent(2, "a", "I will look."), "message-updated");
    open();
    await reading;
    expect(log.msgs.map((m) => [m.n, m.text, !!m.writing])).toEqual([
      [1, "hi", false],
      [2, "I will look.", false],
    ]);
  });

  test("taken back: out, and not put back by a page read after", async () => {
    const all = [person(1), agent(2, "a")];
    const { log } = server(all);
    await log.newer();
    log.heard(agent(2, "a"), "message-deleted");
    expect(log.msgs.map((m) => m.n)).toEqual([1]);
    log.take({ data: all, start: 1, end: 2, more: false });
    expect(log.msgs.map((m) => m.n)).toEqual([1]);
  });

  test("words being written: the whole of them each time, the row the same, at its end not writing", async () => {
    const { log } = server([person(1)]);
    await log.newer();
    log.heard(agent(2, "a", "I", { writing: true }));
    const key = log.groups(mine).at(-1)!.key;
    log.heard(agent(2, "a", "I will", { writing: true }), "message-updated");
    log.heard(agent(2, "a", "I will look.<iridium:work steps=\"1\" running=\"true\" tool=\"Bash\" at=\"5\" from=\"40\"/>"), "message-updated");
    const m = log.msgs.at(-1)!;
    expect(m).toMatchObject({ n: 2, text: "I will look.", work: { steps: 1, running: true, tool: "Bash", at: 5, from: 40 } });
    expect(m.writing).toBeUndefined();
    expect(log.wrote.has(2)).toBe(true);
    expect(log.groups(mine).at(-1)!.key).toBe(key);
  });

  test("an ask's card (no number of the log): its line is read in its place; its closing changes nothing", async () => {
    const all = [person(1)];
    const { log, asked } = server(all);
    await log.newer();
    all.push(agent(2, "a", "允许吗？", { kind: "ask" }));
    log.heard({ id: "ask:a:r1", content: "<p>允许吗？</p>" }, "message-created");
    await log.newer();
    expect(log.msgs.map((m) => [m.n, m.kind])).toEqual([
      [1, undefined],
      [2, "ask"],
    ]);
    const n = asked.length;
    log.heard({ id: "ask:a:r1", content: "closed" }, "message-updated");
    expect(asked).toHaveLength(n);
  });

  test("the stream back after a while: what was still being written then is read again", async () => {
    const all = [person(1), agent(2, "a", "half", { writing: true }), person(3)];
    const { log, asked } = server(all);
    await log.newer();
    all[1] = agent(2, "a", "half and whole");
    await log.newer(true);
    expect(asked.at(-1)).toEqual({ after: 3 });
    expect(asked).toContainEqual({ after: 1 });
    expect(log.msgs[1]).toMatchObject({ n: 2, text: "half and whole" });
    expect(log.msgs[1]!.writing).toBeUndefined();
  });
});

describe("what was sent from here", () => {
  test("its bubble becomes its message by its input id alone, where the bubble was, under its key", async () => {
    const { log } = server([person(1)]);
    await log.newer();
    const x = sent("x", "hello");
    log.send(x);
    expect(drawn(log)).toBe("1,(x)");
    const key = log.groups(mine)[0]!.lines[1]!.key;
    // Others' words come first, then a person's same words not of this send: neither is it.
    log.heard(agent(2, "a"));
    log.heard(person(3, "hello", "another"));
    expect(drawn(log)).toBe("1,(x) | 2 | 3");
    log.heard(person(4, "hello", "in-x"));
    expect(drawn(log)).toBe("1,4 | 2 | 3");
    expect(log.groups(mine)[0]!.lines[1]!.key).toBe(key);
    expect(log.sent).toEqual([]);
  });

  test("by its number once the server said it, the event without its input id", async () => {
    const { log } = server([person(1)]);
    await log.newer();
    const x = sent("x", "hello", { input: undefined });
    log.send(x);
    log.heard(person(2, "hello"));
    expect(drawn(log)).toBe("1,(x),2");
    x.seq = 2;
    log.answered(x);
    expect(drawn(log)).toBe("1,2");
  });

  test("failed, it stays to be sent again; failed but come (the answer lost), it is its message", async () => {
    const { log } = server([person(1)]);
    await log.newer();
    const x = sent("x");
    log.send(x);
    x.failed = "timeout";
    log.answered(x);
    expect(log.sent).toEqual([x]);
    log.heard(person(2, "hi", "in-x"));
    expect(log.sent).toEqual([]);
  });

  test("own and others' words interleaved keep the order they were drawn in; opened again, the server's", async () => {
    const { log } = server([agent(1, "a")]);
    await log.newer();
    const x = sent("x");
    const y = sent("y");
    log.send(x);
    log.heard(agent(2, "a", "meanwhile"));
    log.send(y);
    expect(drawn(log)).toBe("1 | (x) | 2 | (y)");
    // The server had #2 before either: x is #3, y #4. Nothing drawn moves.
    log.heard(person(4, "hi", "in-y"));
    log.heard(person(3, "hi", "in-x"));
    expect(drawn(log)).toBe("1 | 3 | 2 | 4");
    expect(grouped(ordered(log.msgs, new Map(), []), mine).map((g) => g.lines.map((l) => l.m!.n).join(",")).join(" | ")).toBe("1,2 | 3,4");
  });
});

describe("heads", () => {
  test("one sender's in a row share one; a bubble with the one looking's; an agent's work with its words", async () => {
    const { log } = server([person(1), person(2, "hi", undefined, "other"), agent(3, "a", '<iridium:work steps="2" from="9" to="12" ms="900"/>', { kind: "work" }), agent(4, "a", "done"), agent(5, "b")]);
    await log.newer();
    log.send(sent("x"));
    expect(drawn(log)).toBe("1 | 2 | 3,4 | 5 | (x)");
    expect(log.msgs[2]).toMatchObject({ kind: "work", text: "", work: { steps: 2, running: false, from: 9, to: 12, ms: 900 } });
    log.heard(person(6, "hi", "in-x"));
    log.send(sent("y"));
    expect(drawn(log)).toBe("1 | 2 | 3,4 | 5 | 6,(y)");
  });
});

describe("work", () => {
  test("read from the element after the words", () => {
    expect(workIn('x<iridium:work steps="3" running="true" tool="Bash" at="10" from="100"/>')).toEqual({ steps: 3, running: true, tool: "Bash", at: 10, from: 100 });
    expect(workIn('<iridium:workflow name="x"/>')).toBeUndefined();
    expect(msgOf(agent(7, "a", 'done<iridium:work steps="1" from="5" to="9"/>'))).toMatchObject({ text: "done", work: { steps: 1, running: false, from: 5, to: 9 } });
  });
  test("what an older message says was done before it, where the same agent's message before has it as its work: not twice", () => {
    const did = '<iridium:activity bash="2"></iridium:activity>';
    const ms = [agent(1, "a", 'look<iridium:work steps="2" from="1" to="5"/>'), agent(2, "b", `x${did}`), agent(3, "a", `done${did}`), agent(4, "a", `again${did}`)].map((m) => msgOf(m)!);
    expect([...doneBefore(ms)]).toEqual([3]);
  });
});
