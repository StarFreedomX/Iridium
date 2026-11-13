// A channel of several agents, what the page reads of it (src/chat/channel/lib.ts, log.ts).
import { describe, expect, test } from "vitest";
import type { ChannelMessage, ChannelPage } from "../src/api/client";
import type { Session } from "../src/api/types.gen";
import { eventParts, personName, type EventWords, channelLamp, givenParts, givenTurn, groupMessages, insertNick, isMulti, linkNicks, matchAgents, merge, msgOf, nickOfURL, nickParts, nickSpans, quotaKinds, readMarks, stillWaiting, validNick, watchExtra, workOf } from "../src/chat/channel/lib";
import { ChannelLog } from "../src/chat/channel/log";
import { buildTree, standing } from "../src/tree";

const agent = (n: number, session: string, text = "hi"): ChannelMessage => ({ id: String(n), content: text, user: { id: `agent:${session}`, name: "pi Low", nick: session, is_bot: true }, created_at: n });
const person = (n: number, text = "hi"): ChannelMessage => ({ id: String(n), content: text, user: { id: "local", name: "主机" }, created_at: n });
const note = (n: number, text = "x"): ChannelMessage => ({ id: String(n), content: text, user: { id: "iridium", name: "Iridium", is_bot: true } });
const msgs = (...ms: ChannelMessage[]) => ms.map((m) => msgOf(m)!);

describe("a channel's messages", () => {
  test("read: the number, the words unescaped, who said it, the files", () => {
    const m = msgOf({ id: "12", content: 'a &lt;b&gt; <img src="internal:x/y/ref1" title="p.png" path="/tmp/p.png"/>', user: { id: "agent:s1", name: "Claude Opus", nick: "cc", is_bot: true }, created_at: 5, _data: { kind: "reply" } })!;
    expect(m).toMatchObject({ n: 12, text: "a <b> ", time: 5, kind: "reply", author: { kind: "agent", session: "s1", nick: "cc", name: "Claude Opus" } });
    expect(m.files.map((f) => f.ref)).toEqual(["ref1"]);
    expect(msgOf(person(1))!.author).toEqual({ kind: "person", id: "local", name: "主机" });
    expect(msgOf(note(2))!.author).toEqual({ kind: "iridium" });
    expect(msgOf({ id: "ask:s1:r", content: "" })).toBeUndefined();
  });
  test("grouped: an agent's in a row share a head; a person's and Iridium's stand alone", () => {
    const g = groupMessages(msgs(person(1), person(2), agent(3, "a"), agent(4, "a"), agent(5, "b"), note(6), agent(7, "b"), agent(8, "b")));
    expect(g.map((x) => x.msgs.map((m) => m.n))).toEqual([[1], [2], [3, 4], [5], [6], [7, 8]]);
    expect(g.map((x) => x.key)).toEqual(["m1", "m2", "m3", "m5", "m6", "m7"]);
  });
  test("merged: each number once, in order, the later reading kept; nothing new, the same array", () => {
    const have = msgs(person(1), agent(3, "a"));
    expect(merge(have, [])).toBe(have);
    expect(merge(have, msgs(agent(3, "a")))).toBe(have);
    const next = merge(have, msgs(agent(2, "b"), agent(3, "a", "changed"), agent(3, "a", "changed")));
    expect(next.map((m) => [m.n, m.text])).toEqual([[1, "hi"], [2, "hi"], [3, "changed"]]);
    // The kind an event said stays when the log, which says none, reads the message again.
    const said = merge([{ ...msgs(agent(4, "a"))[0]!, kind: "reply" }], msgs(agent(4, "a", "more")));
    expect(said[0]).toMatchObject({ text: "more", kind: "reply" });
  });
  test("sent from here: gone once the log has its number, or before that the same words said since", () => {
    const log = msgs(person(1, "one"), agent(2, "a"), person(3, "two"));
    expect(stillWaiting({ text: "two", seq: 3, from: 2 }, log)).toBe(false);
    expect(stillWaiting({ text: "two", seq: 4, from: 2 }, log)).toBe(true);
    expect(stillWaiting({ text: " two ", from: 2 }, log)).toBe(false);
    expect(stillWaiting({ text: "one", from: 2 }, log)).toBe(true); // said before it was sent
    expect(stillWaiting({ text: "hi", from: 0 }, msgs(agent(1, "a")))).toBe(true); // an agent's, not yours
    expect(stillWaiting({ text: "two", seq: 3, from: 2, failed: "no" }, log)).toBe(true);
  });
});

describe("the log held", () => {
  const pages = (all: ChannelMessage[]) => {
    const asked: { before?: number; after?: number }[] = [];
    const get = async (_: string, q: { before?: number; after?: number }): Promise<ChannelPage> => {
      asked.push(q);
      const n = (m: ChannelMessage) => Number(m.id);
      const data = q.after !== undefined ? all.filter((m) => n(m) > q.after!) : all.filter((m) => q.before === undefined || n(m) < q.before).slice(-2);
      return { data, start: n(data[0] ?? { id: "0", content: "" }), end: n(data.at(-1) ?? { id: "0", content: "" }), more: !!data.length && n(data[0]!) > Number(all[0]!.id) };
    };
    return { asked, get };
  };
  test("the newest page, the pages before, what came after; an event's message once", async () => {
    const all = [person(1), agent(2, "a"), person(3), agent(4, "a")];
    const { asked, get } = pages(all);
    const log = new ChannelLog("c", get);
    await log.newer();
    expect(log.msgs.map((m) => m.n)).toEqual([3, 4]);
    expect(log.more).toBe(true);
    expect(await log.older()).toBe(true);
    expect(log.msgs.map((m) => m.n)).toEqual([1, 2, 3, 4]);
    expect(await log.older()).toBe(false);
    // The next one by its event: put in, nothing fetched; the same again changes nothing.
    all.push(agent(5, "b"));
    const n = asked.length;
    log.heard(all[4]!);
    const v = log.version;
    log.heard(all[4]!);
    expect(log.msgs.map((m) => m.n)).toEqual([1, 2, 3, 4, 5]);
    expect(log.version).toBe(v);
    expect(asked).toHaveLength(n);
    // One further on: those between were missed, and are fetched.
    all.push(person(6), agent(7, "a"));
    log.heard(all[6]!);
    await log.newer();
    expect(log.msgs.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("@nick", () => {
  const nicks = ["pi", "pi2", "cc"];
  test("found as the server finds it: by itself, outside code and quotes, any case", () => {
    const at = (t: string) => nickSpans(t, nicks).map((s) => s.nick);
    expect(at("@pi2 hello @PI, and @cc.")).toEqual(["pi2", "pi", "cc"]);
    expect(at("mail a@pi.dev, x/@pi, @@pi, @pi3, @pi-x")).toEqual([]);
    expect(at("`@pi` then @cc")).toEqual(["cc"]);
    expect(at("```\n@pi\n```\n> @pi2\n@cc")).toEqual(["cc"]);
    expect(at("（@pi）你好@cc")).toEqual(["pi"]);
    expect(nickSpans("a\n@pi b", nicks)).toEqual([{ from: 2, to: 5, nick: "pi" }]);
  });
  test("cut into parts, and linked in Markdown", () => {
    expect(nickParts("@pi2 回一个字，@nobody", nicks)).toEqual([{ nick: "pi2" }, " 回一个字，@nobody"]);
    expect(nickParts("no one", nicks)).toEqual(["no one"]);
    expect(linkNicks("ask @PI2 and `@pi`", nicks)).toBe("ask [@pi2](ir:member/pi2) and `@pi`");
    expect(nickOfURL("ir:member/pi2")).toBe("pi2");
    expect(nickOfURL("ir:member/%E5%B0%8F%E7%8C%AB")).toBe("小猫");
    expect(nickOfURL("ir:session/abcd1234")).toBeUndefined();
  });
  test("put into the composer: over the @word typed, a space before it where one is needed", () => {
    expect(insertNick("hello @p", 6, 8, "pi2")).toEqual({ text: "hello @pi2 ", caret: 11 });
    expect(insertNick("", 0, 0, "pi")).toEqual({ text: "@pi ", caret: 4 });
    expect(insertNick("ab", 2, 2, "pi")).toEqual({ text: "ab @pi ", caret: 7 });
    expect(insertNick("a\n@ rest", 2, 3, "pi")).toEqual({ text: "a\n@pi rest", caret: 6 });
  });
  test("a nick: letters, digits, _ and -, 32 at most", () => {
    expect(["pi", "小猫-2", "a_b", "x".repeat(32)].every(validNick)).toBe(true);
    expect(["", "a b", "a.b", "@a", "x".repeat(33)].some(validNick)).toBe(false);
  });
  test("the agents an @ lists: nicks that start with it, then nicks and names that have it", () => {
    const rows = [
      { nick: "pi", name: "pi Flash" },
      { nick: "cc", name: "Claude Opus" },
      { nick: "opi", name: "Codex" },
    ];
    expect(matchAgents(rows, "").map((r) => r.nick)).toEqual(["pi", "cc", "opi"]);
    expect(matchAgents(rows, "p").map((r) => r.nick)).toEqual(["pi", "opi", "cc"]);
    expect(matchAgents(rows, "zz")).toEqual([]);
  });
});

describe("what an agent was given", () => {
  test("a channel's message: its number, its words, the channel it was called in", () => {
    expect(givenTurn("plain words")).toBeNull();
    expect(givenTurn("#4: hello\nthere\n\n<channel-context>\nYou are claude in a channel shared with people.\n</channel-context>")).toEqual({ seq: 4, words: "hello\nthere" });
    expect(givenTurn('#12: @pi look\n\n<channel-context>\nYou are pi, called in the channel "Room 1" (abc-123), which people and other agents share.\n</channel-context>')).toEqual({ seq: 12, words: "@pi look", channel: { id: "abc-123", name: "Room 1" } });
    expect(givenTurn('#2: x\n\n<channel-context>\nYou are pi, called in the channel "R", which people and other agents share.')?.channel).toEqual({ id: "", name: "R" });
  });
});

describe("who has read", () => {
  test("a reader's mark is under the group that holds the last message it read", () => {
    const m = (n: number, session?: string) => ({ n, text: "", files: [], author: session ? { kind: "agent" as const, session, nick: session, name: "" } : { kind: "person" as const, id: "u", name: "u" } });
    const groups = groupMessages([m(1), m(2, "a"), m(3, "a"), m(5)] as never);
    const marks = readMarks(groups, [{ member: "x", seq: 3 }, { member: "y", seq: 9 }, { member: "me", seq: 9 }, { member: "z", seq: 0 }, { member: "w", seq: 4 }], "me");
    expect([...marks].map(([k, rs]) => `${k}:${rs.map((r) => r.member).join("")}`)).toEqual(["m2:xw", "m5:y"]);
  });
});

describe("the list", () => {
  const s = (id: string, more: Partial<Session> = {}): Session => ({ id, agent: "pi", cwd: "/w", status: "idle", hosted: true, live: false, updatedAt: 1, ...more }) as Session;
  const list = [s("c", { agents: [{ session: "c", nick: "pi" }, { session: "m", nick: "pi2" }], own: true }), s("m", { in: ["c"], spawned: { channel: "c" }, own: true, live: true }), s("o", { own: true })];
  test("an agent in another's channel is a session as any: a row of its own, not hung under the channel", () => {
    expect(isMulti(list[0])).toBe(true);
    expect(isMulti(list[1])).toBe(false);
    const st = standing(list);
    expect([...st.rows].sort()).toEqual(["c", "m", "o"]);
    expect(st.hung.size).toBe(0);
    const tree = buildTree([...list, s("sub", { subagent: true, parent: "m", updatedAt: 100 })], [], "未归类", 100);
    expect(
      tree.workspaces
        .flatMap((w) => w.rows)
        .flatMap((r) => (r.kind === "session" ? [r.s.id] : r.f.sessions.map((x) => x.id)))
        .sort()
        .join(),
    ).toBe("c,m,o");
    // What it started shows under its own row.
    expect(tree.kids.get("m")?.map((x) => x.id)).toEqual(["sub"]);
  });
  test("a channel's lamp: amber while one waits, else lit while any works", () => {
    expect(channelLamp("idle", ["idle", "running"])).toBe("running");
    expect(channelLamp("idle", ["compacting"])).toBe("running");
    expect(channelLamp("running", ["waiting"])).toBe("waiting");
    expect(channelLamp("starting", ["idle"])).toBe("starting");
    expect(channelLamp("error", ["idle"])).toBe("error");
    expect(channelLamp("idle", [])).toBe("idle");
  });
  test("the quotas: one per kind of agent and machine, with every model in use", () => {
    expect(
      quotaKinds([
        { agent: "claude", using: ["opus", undefined], live: false },
        { agent: "pi", using: ["flash"] },
        { agent: "claude", using: ["opus", "haiku"], live: true },
        { agent: "claude", machine: "mac", using: [] },
      ]),
    ).toEqual([
      { agent: "claude", using: ["opus", "haiku"], live: true },
      { agent: "pi", using: ["flash"], live: false },
      { agent: "claude", machine: "mac", using: [], live: false },
    ]);
  });
  test("the states asked of the stream: the other agents' sessions, then their contexts", () => {
    expect(watchExtra("c", ["c", "m", "n"])).toEqual(["session:m", "session:n", "context:m", "context:n"]);
  });
  test("what an agent was given: each part's source, values and the messages it cites", () => {
    const rec = { kind: "turn-prefix", parts: [{ source: "prompts:channel.message", hash: "c1", values: { seq: "6" } }, { source: "input", hash: "65", refs: [{ kind: "input", id: "8afe" }, { kind: "message", id: "6" }] }] };
    expect(givenParts(rec)).toEqual([
      { source: "prompts:channel.message", values: [["seq", "6"]], refs: [] },
      { source: "input", values: [], refs: ["#6"] },
    ]);
    expect(givenParts(null)).toEqual([]);
    expect(givenParts({ parts: "x" })).toEqual([]);
  });
});

import { didOf } from "../src/chat/channel/lib";

describe("didOf", () => {
  test("reads what the agent did from the element after the words", () => {
    const d = didOf('done<iridium:activity bash="3" failed="1" cmds="go 2, git 1" read="4" search="1" fetch="2" files="2" add="12" del="3" ms="900"><iridium:file path="/w/a &amp; b.go" add="10" del="3"/><iridium:file path="/w/c.go" add="2"/></iridium:activity>');
    expect(d).toEqual({ bash: 3, failed: 1, cmds: "go 2, git 1", read: 4, web: 3, agents: 0, other: 0, files: 2, add: 12, del: 3, paths: [{ path: "/w/a & b.go", add: 10, del: 3 }, { path: "/w/c.go", add: 2, del: 0 }] });
    expect(didOf("just words")).toBeUndefined();
  });
});

describe("a channel's events", () => {
  const w: EventWords = { join: "{nick} 已加入", leave: "{nick} 已移出", rename: "{from} 改名 {nick}", recv: "{nick} 接收{recv}", everyone: "人：全部", added: "已加入：{added}", removed: "已移出：{removed}", undelivered: "#{seq} 未送达 {nick}", stopped: "#{seq} 未转交", by: "（{by}）", sep: "，", all: "全部", at: "@我" };
  test("join and leave: the agent, then who did it", () => {
    expect(eventParts({ type: "join", member: "agent:s", nick: "pi2", name: "pi Low", by: "主机" }, w)).toEqual([{ nick: "pi2" }, " 已加入（主机）"]);
    expect(eventParts({ type: "leave", nick: "pi2" }, w)).toEqual([{ nick: "pi2" }, " 已移出"]);
  });
  test("rename: the old nick as words, the new one the agent", () => {
    expect(eventParts({ type: "rename", from: "pi2", nick: "bob", by: "主机" }, w)).toEqual(["@pi2 改名 ", { nick: "bob" }, "（主机）"]);
  });
  test("recv: what it receives now", () => {
    expect(eventParts({ type: "recv", nick: "pi", recv: "all" }, w)).toEqual([{ nick: "pi" }, " 接收全部"]);
    expect(eventParts({ type: "recv", nick: "pi", recv: "at" }, w)).toEqual([{ nick: "pi" }, " 接收@我"]);
  });
  test("people: everyone, or those added and removed", () => {
    expect(eventParts({ type: "people", everyone: true, by: "主机" }, w)).toEqual(["人：全部（主机）"]);
    expect(eventParts({ type: "people", added: ["ir_web/a"], removed: ["bot/*", "ir_web/b"] }, w)).toEqual(["已加入：", { people: ["ir_web/a"] }, "，已移出：", { people: ["bot/*", "ir_web/b"] }]);
    expect(eventParts({ type: "people" }, w)).toBeUndefined();
  });
  test("undelivered and stopped: the message's number", () => {
    expect(eventParts({ type: "undelivered", seq: 12, nick: "pi2" }, w)).toEqual(["#12 未送达 ", { nick: "pi2" }]);
    expect(eventParts({ type: "stopped", seq: 9 }, w)).toEqual(["#9 未转交"]);
  });
  test("one not known: none, its own text is shown", () => {
    expect(eventParts({ type: "later" }, w)).toBeUndefined();
  });
  test("read from a message, and Iridium's lines in a row grouped", () => {
    const line = (n: number): ChannelMessage => ({ id: String(n), content: "x", user: { id: "iridium" }, _data: { kind: "note", event: { type: "join", nick: "pi2" } } });
    expect(msgOf(line(3))!.event).toEqual({ type: "join", nick: "pi2" });
    expect(groupMessages(msgs(person(1), line(2), line(3), agent(4, "a"), line(5))).map((g) => g.msgs.map((m) => m.n))).toEqual([[1], [2, 3], [4], [5]]);
  });
  test("people by name: an app's all its name, a login its own", () => {
    const apps = [{ id: "ir_web", name: "面板" }, { id: "bot", name: "QQ" }];
    const logins = [{ app: "ir_web", id: "a", name: "kumo" }];
    expect(personName("ir_web/a", apps, logins)).toBe("kumo");
    expect(personName("bot/*", apps, logins)).toBe("QQ");
    expect(personName("ir_web/zz", apps, logins)).toBe("ir_web/zz");
    expect(personName("*", apps, logins)).toBe("*");
  });
});

describe("workOf", () => {
  const bs = [
    { at: "10.0", kind: "user", text: "do it" },
    { at: "11.0", kind: "thinking", text: "hm" },
    { at: "12.0", kind: "tool", name: "Bash" },
    { at: "13.0", kind: "assistant", text: "half way" },
    { at: "14.0", kind: "tool", name: "Read" },
    { at: "15.0", kind: "assistant", text: "done" },
    { at: "16.0", kind: "tool", name: "Edit" },
  ];
  test("said straight out: after the last words before its block", () => {
    expect(workOf(bs, { session: "s", block: "15.0" }).map((b) => b.at)).toEqual(["14.0"]);
    expect(workOf(bs, { session: "s", block: "13.0" }).map((b) => b.at)).toEqual(["11.0", "12.0"]);
  });
  test("with ir: the lines from..to, but what it was given", () => {
    expect(workOf(bs, { session: "s", from: 10, to: 16 }).map((b) => b.at)).toEqual(["11.0", "12.0", "13.0", "14.0", "15.0"]);
  });
});

describe("a message that answers another", () => {
  test("its <quote id/> is the number it answers", () => {
    const m = msgOf({ id: "7", content: '<quote id="3"/>more please', user: { id: "u", name: "kumo" } });
    expect(m?.quote).toBe(3);
    expect(m?.text).toBe("more please");
    expect(msgOf({ id: "8", content: "plain", user: { id: "u", name: "kumo" } })?.quote).toBeUndefined();
  });
});
