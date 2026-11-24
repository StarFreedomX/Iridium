// A channel of several agents, what the page reads of it (src/chat/channel/lib.ts, log.ts).
import { describe, expect, test } from "vitest";
import type { ChannelMessage, ChannelPage } from "../src/api/client";
import type { Session } from "../src/api/types.gen";
import { askQueue, eventParts, personName, type EventWords, channelLamp, givenParts, givenTurn, groupMessages, insertNick, isMulti, linkNicks, matchAgents, mayDM, merge, msgOf, ownAgent, nickOfURL, nickParts, nickSpans, readMarks, stillWaiting, userOf, validNick, watchExtra, workOf, liveOf, liveParts } from "../src/chat/channel/lib";
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
    expect(msgOf({ id: "3", content: "hi", user: { id: "script:echo", name: "echo", is_bot: true } })!.author).toEqual({ kind: "script", name: "echo" });
    expect(msgOf({ id: "4", content: "hi", user: { id: "iridium", name: "echo" }, _data: { script: "echo" } })!.author).toEqual({ kind: "script", name: "echo" });
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
    // One heard as it was said, then read with where it is from in its agent's record: that kept.
    const heard = msgs(agent(5, "a"));
    const backed = merge(heard, [msgOf({ ...agent(5, "a"), _data: { session: "a", block: "12.0" } })!]);
    expect(backed).not.toBe(heard);
    expect(backed[0]!.src).toEqual({ session: "a", block: "12.0" });
    expect(merge(backed, [msgOf({ ...agent(5, "a"), _data: { session: "a", block: "12.0" } })!])).toBe(backed);
  });
  test("sent from here: gone once the log has its number, or before that the same words said since", () => {
    const log = msgs(person(1, "one"), agent(2, "a"), person(3, "two"));
    expect(stillWaiting({ text: "two", seq: 3, from: 2 }, log)).toBe(false);
    expect(stillWaiting({ text: "two", seq: 4, from: 2 }, log)).toBe(true);
    expect(stillWaiting({ text: " two ", from: 2 }, log)).toBe(false);
    expect(stillWaiting({ text: "one", from: 2 }, log)).toBe(true); // said before it was sent
    expect(stillWaiting({ text: "hi", from: 0 }, msgs(agent(1, "a")))).toBe(true); // an agent's, not yours
    expect(stillWaiting({ text: "two", seq: 3, from: 2, failed: "no" }, log)).toBe(true);
    // Made long after the same words were said: not those.
    expect(stillWaiting({ text: "two", from: 0, made: 3 + 3_600_000 }, log)).toBe(true);
    expect(stillWaiting({ text: "two", from: 0, made: 3 + 1_000 }, log)).toBe(false);
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
  test("people, apps and the names of all are named as agents are; a name with a space, the longest that fits", () => {
    const names = ["pi", "Alice", "Alice Liddell", "kumo.dev", "全体成员", "全体Agent"];
    const at = (t: string) => nickSpans(t, names).map((s) => s.nick);
    expect(at("@alice liddell, @Alice and @pi")).toEqual(["Alice Liddell", "Alice", "pi"]);
    expect(at("@Alicex @kumo.dev @全体成员 请看，@全体agent")).toEqual(["kumo.dev", "全体成员", "全体Agent"]);
    expect(nickSpans("hi @Alice Liddell!", names)).toEqual([{ from: 3, to: 17, nick: "Alice Liddell" }]);
    expect(linkNicks("@Alice Liddell 看", names)).toBe("[@Alice Liddell](ir:member/Alice%20Liddell) 看");
    expect(nickOfURL("ir:member/Alice%20Liddell")).toBe("Alice Liddell");
  });
  test("a person's member string as a user id: a login's own, an app's for all of it", () => {
    expect(userOf("ir_web/u1")).toBe("u1");
    expect(userOf("bot/*")).toBe("bot");
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
    expect(givenTurn("#4: hello\nthere\n\n<channel-context>\nYou are claude in a channel shared with people.\n</channel-context>")).toEqual({ seq: 4, words: "hello\nthere", context: "You are claude in a channel shared with people." });
    expect(givenTurn('#12: @pi look\n\n<channel-context>\nYou are pi, called in the channel "Room 1" (abc-123), which people and other agents share.\n</channel-context>')).toEqual({ seq: 12, words: "@pi look", context: 'You are pi, called in the channel "Room 1" (abc-123), which people and other agents share.', channel: { id: "abc-123", name: "Room 1" } });
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

describe("the asks queue", () => {
  const ask = (id: string) => ({ requestId: id, card: { id: `ask:x:${id}` } }) as { requestId: string; card: { id: string } };
  test("one queue, oldest first: a later ask of the first agent after an earlier one of the second", () => {
    const seen = new Map<string, number>();
    expect(askQueue([{ session: "a", asks: [] }, { session: "b", asks: [ask("1")] }], seen, 10).map((q) => q.ask.requestId)).toEqual(["1"]);
    const q = askQueue([{ session: "a", asks: [ask("2")] }, { session: "b", asks: [ask("1")] }], seen, 20);
    expect(q.map((x) => `${x.session}${x.ask.requestId}@${x.at}`)).toEqual(["b1@10", "a2@20"]);
  });
  test("seen at once: in the agents' order; one answered leaves the queue and what was seen", () => {
    const seen = new Map<string, number>();
    expect(askQueue([{ session: "a", asks: [ask("1"), ask("2")] }, { session: "b", asks: [ask("3")] }], seen, 5).map((q) => q.ask.requestId)).toEqual(["1", "2", "3"]);
    askQueue([{ session: "a", asks: [ask("2")] }, { session: "b", asks: [ask("3")] }], seen, 6);
    expect([...seen.keys()]).toEqual(["ask:x:2", "ask:x:3"]);
  });
});

describe("the list", () => {
  const s = (id: string, more: Partial<Session> = {}): Session => ({ id, agent: "pi", cwd: "/w", status: "idle", hosted: true, live: false, updatedAt: 1, ...more }) as Session;
  const list = [s("c", { agents: [{ session: "c", nick: "pi" }, { session: "m", nick: "pi2" }], own: true }), s("m", { in: ["c"], spawned: { channel: "c" }, own: true, live: true }), s("o", { own: true })];
  test("an agent in another's channel is a session as any: a row of its own in the tree, hung under none, nor drawn under its channel's row (kumo, 2026-11-15: in the members key)", () => {
    expect(isMulti(list[0])).toBe(true);
    expect(isMulti(list[1])).toBe(false);
    const st = standing(list);
    expect([...st.rows].sort()).toEqual(["c", "m", "o"]);
    expect(st.hung.size).toBe(0);
    // Spawned for c and still in it: no row (kumo, 2026-11-15), still found by the jump box.
    const tm = buildTree(list, [], "未归类", 100);
    expect(tm.workspaces.flatMap((w) => w.rows).map((r) => (r.kind === "session" ? r.s.id : ""))).toEqual(expect.not.arrayContaining(["m"]));
    expect(tm.member.get("m")).toBe("c");
    expect(tm.unlisted.has("m")).toBe(false);
    // Out of it: a row as any.
    const out = buildTree([list[0]!, { ...list[1]!, in: [] }, list[2]!], [], "未归类", 100);
    expect(out.member.size).toBe(0);
    // Invited, not spawned for it: a row of its own.
    const tree = buildTree([list[0]!, { ...list[1]!, spawned: undefined }, list[2]!, s("sub", { subagent: true, parent: "m", updatedAt: 100 })], [], "未归类", 100);
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
  test("the channel's own agent: the session the channel is", () => {
    expect(ownAgent("c", { session: "c" })).toBe(true);
    expect(ownAgent("c", { session: "m" })).toBe(false);
    expect(ownAgent("c", {})).toBe(false); // a person
  });
  test("私聊: the host and logins only, not an app or an author that is no login", () => {
    const logins = [{ id: "u1" }];
    expect(mayDM("local", logins)).toBe(true);
    expect(mayDM("u1", logins)).toBe(true);
    expect(mayDM("bot", logins)).toBe(false);
    expect(mayDM("u2", [])).toBe(false);
  });
  test("a channel's lamp: amber while one waits, else lit while any works", () => {
    expect(channelLamp("idle", ["idle", "running"])).toBe("running");
    expect(channelLamp("idle", ["compacting"])).toBe("running");
    expect(channelLamp("running", ["waiting"])).toBe("waiting");
    expect(channelLamp("starting", ["idle"])).toBe("starting");
    expect(channelLamp("error", ["idle"])).toBe("error");
    expect(channelLamp("idle", [])).toBe("idle");
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

import { didOf, saidBefore, type Msg } from "../src/chat/channel/lib";

describe("didOf", () => {
  test("reads what the agent did from the element after the words", () => {
    const d = didOf('done<iridium:activity bash="3" failed="1" cmds="go 2, git 1" read="4" search="1" fetch="2" files="2" add="12" del="3" ms="900"><iridium:file path="/w/a &amp; b.go" add="10" del="3"/><iridium:file path="/w/c.go" add="2"/></iridium:activity>');
    expect(d).toEqual({ bash: 3, failed: 1, cmds: "go 2, git 1", read: 4, web: 3, agents: 0, other: 0, files: 2, add: 12, del: 3, paths: [{ path: "/w/a & b.go", add: 10, del: 3 }, { path: "/w/c.go", add: 2, del: 0 }] });
    expect(didOf("just words")).toBeUndefined();
  });
});

describe("a channel's events", () => {
  const w: EventWords = { join: "{nick} 已加入", leave: "{nick} 已移出", rename: "{from} 改名 {nick}", recv: "{nick} 接收{recv}", on: "{nick} 订阅事件：{on}", wake: "{nick} 的唤醒：{on}", everyone: "人：全部", added: "已加入：{added}", removed: "已移出：{removed}", undelivered: "#{seq} 未送达 {nick}", stopped: "#{seq} 未转交", silent: "#{seq} {nick} 未发话", silentWhy: "#{seq} {nick} 未发话：{reason}", by: "（{by}）", sep: "，", reasons: { 余额不足: "no balance left" }, script: { add: "{by} 添加了命令「{script}」", remove: "{by} 删除了命令「{script}」", enabled: "{by} 启用了命令「{script}」", disabled: "{by} 停用了命令「{script}」", changed: "{by} 修改了命令「{script}」", renamed: "{by} 把命令「{old}」改名为「{script}」" } };
  test("join and leave: the agent, then who did it", () => {
    expect(eventParts({ type: "join", member: "agent:s", nick: "pi2", name: "pi Low", by: "主机" }, w)).toEqual([{ nick: "pi2" }, " 已加入（Iridium）"]);
    expect(eventParts({ type: "leave", nick: "pi2" }, w)).toEqual([{ nick: "pi2" }, " 已移出"]);
  });
  test("rename: the old nick as words, the new one the agent", () => {
    expect(eventParts({ type: "rename", from: "pi2", nick: "bob", by: "主机" }, w)).toEqual(["@pi2 改名 ", { nick: "bob" }, "（Iridium）"]);
  });
  test("recv: its receive set now, the old words read as sets", () => {
    expect(eventParts({ type: "recv", nick: "pi", recv: ["*", "agent:s2"] }, w)).toEqual([{ nick: "pi" }, " 接收", { recv: ["*", "agent:s2"] }]);
    expect(eventParts({ type: "recv", nick: "pi", recv: "all" }, w)).toEqual([{ nick: "pi" }, " 接收", { recv: ["*"] }]);
    expect(eventParts({ type: "recv", nick: "pi", recv: "at" }, w)).toEqual([{ nick: "pi" }, " 接收", { recv: [] }]);
  });
  test("script: what was done to it, by whom, in the line's own words", () => {
    expect(eventParts({ type: "script", name: "echo", what: ["add"], by: "kumo" }, w)).toEqual(["kumo 添加了命令「echo」"]);
    expect(eventParts({ type: "script", name: "echo", what: ["disabled"], by: "kumo" }, w)).toEqual(["kumo 停用了命令「echo」"]);
    expect(eventParts({ type: "script", name: "echo", what: ["run", "on"], by: "kumo" }, w)).toEqual(["kumo 修改了命令「echo」"]);
    expect(eventParts({ type: "script", name: "echo2", from: "echo", what: ["name"], by: "kumo" }, w)).toEqual(["kumo 把命令「echo」改名为「echo2」"]);
    expect(eventParts({ type: "script", name: "echo", what: ["remove"] }, w)).toEqual(["删除了命令「echo」"]);
    expect(eventParts({ type: "script", what: ["add"] }, w)).toBeUndefined();
  });
  test("people: everyone, or those added and removed", () => {
    expect(eventParts({ type: "people", everyone: true, by: "主机" }, w)).toEqual(["人：全部（Iridium）"]);
    expect(eventParts({ type: "people", added: ["ir_web/a"], removed: ["bot/*", "ir_web/b"] }, w)).toEqual(["已加入：", { people: ["ir_web/a"] }, "，已移出：", { people: ["bot/*", "ir_web/b"] }]);
    expect(eventParts({ type: "people" }, w)).toBeUndefined();
  });
  test("undelivered and stopped: the message's number", () => {
    expect(eventParts({ type: "undelivered", seq: 12, nick: "pi2" }, w)).toEqual(["#12 未送达 ", { nick: "pi2" }]);
    expect(eventParts({ type: "stopped", seq: 9 }, w)).toEqual(["#9 未转交"]);
    expect(eventParts({ type: "silent", seq: 7, nick: "pi2" }, w)).toEqual(["#7 ", { nick: "pi2" }, " 未发话"]);
    // Its turn ended in an error: why, a usual reason in the page's words, another as it came.
    expect(eventParts({ type: "silent", seq: 8, nick: "pi12", reason: "余额不足" }, w)).toEqual(["#8 ", { nick: "pi12" }, " 未发话：no balance left"]);
    expect(eventParts({ type: "silent", seq: 9, nick: "pi12", reason: "boom" }, w)).toEqual(["#9 ", { nick: "pi12" }, " 未发话：boom"]);
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
  test("a reply said for it at its turn's end: its words drawn once, under the work, not in it", () => {
    expect(workOf(bs, { session: "s", from: 10, to: 16 }, " done\n").map((b) => b.at)).toEqual(["11.0", "12.0", "13.0", "14.0"]);
  });
  test("the stretch before ended a line short of its words (a line with nothing to draw between): those words, the message before, are not drawn again in this one", () => {
    // The message before was "half way" (13.0), its stretch ending at 12: this one begins at 12.
    expect(workOf(bs, { session: "s", from: 12, to: 15 }, "done", "half way").map((b) => b.at)).toEqual(["12.0", "14.0"]);
    // Words on the way that are not the message before stay.
    expect(workOf(bs, { session: "s", from: 12, to: 15 }, "done", "other").map((b) => b.at)).toEqual(["12.0", "13.0", "14.0"]);
  });
  test("words said on the way end one stretch and begin the next: drawn under the one before only", () => {
    expect(workOf(bs, { session: "s", from: 10, to: 13 }).map((b) => b.at)).toEqual(["11.0", "12.0"]);
    expect(workOf(bs, { session: "s", from: 13, to: 15 }, "done").map((b) => b.at)).toEqual(["14.0"]);
  });
});

describe("liveOf said", () => {
  test("since words said on the way: not those words again", () => {
    const bs = [
      { at: "1.0", kind: "user", text: "go" },
      { at: "2.0", kind: "tool" },
      { at: "3.0", kind: "assistant", text: "first words" },
      { at: "4.0", kind: "tool" },
    ];
    expect(liveOf(bs, { session: "s", from: 1, to: 3 }).map((b) => b.at)).toEqual(["4.0"]);
  });
});

describe("liveOf spoken", () => {
  test("words heard said without where they are from are not drawn again as at work", () => {
    const bs = [
      { at: "1.0", kind: "user", text: "go" },
      { at: "2.0", kind: "tool" },
      { at: "3.0", kind: "assistant", text: "first words" },
      { at: "4.0", kind: "tool" },
    ];
    expect(liveOf(bs, undefined, (x) => x === "first words").map((b) => b.at)).toEqual(["4.0"]);
    expect(liveOf(bs, undefined, () => false).map((b) => b.at)).toEqual(["2.0", "3.0", "4.0"]);
  });
});

describe("liveOf", () => {
  const bs = [
    { at: "8.0", kind: "tool", name: "Old" },
    { at: "10.0", kind: "user", text: "do it" },
    { at: "11.0", kind: "thinking", text: "hm" },
    { at: "12.0", kind: "tool", name: "Bash" },
    { at: "13.0", kind: "assistant", text: "half way" },
    { at: "13.1", kind: "tool", name: "Read" },
    { at: "14.0", kind: "tool", name: "Edit" },
  ];
  test("since it was last given something", () => {
    expect(liveOf(bs).map((b) => b.at)).toEqual(["11.0", "12.0", "13.0", "13.1", "14.0"]);
  });
  test("after its last words in the channel: said straight out, past their block", () => {
    expect(liveOf(bs, { session: "s", block: "13.0" }).map((b) => b.at)).toEqual(["13.1", "14.0"]);
  });
  test("after its last words in the channel: from where it spoke, those words (at that line) not again", () => {
    expect(liveOf(bs, { session: "s", from: 10, to: 13 }).map((b) => b.at)).toEqual(["13.1", "14.0"]);
  });
  test("words of an earlier turn cut nothing", () => {
    expect(liveOf(bs, { session: "s", block: "5.0" }).map((b) => b.at)).toEqual(["11.0", "12.0", "13.0", "13.1", "14.0"]);
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

describe("liveParts", () => {
  const given = (b: { text?: string }) => (/^#(\d+)/.exec(b.text ?? "") ? Number(/^#(\d+)/.exec(b.text ?? "")![1]) : undefined);
  const bs = [
    { at: "1.0", kind: "user", text: "#5: do it" },
    { at: "2.0", kind: "tool" },
    { at: "3.0", kind: "tool" },
    { at: "4.0", kind: "user", text: "#7: and this" },
    { at: "5.0", kind: "tool" },
    { at: "6.0", kind: "user", text: "#8: more" },
    { at: "7.0", kind: "tool" },
  ];
  test("cuts the turn where it was given something more", () => {
    const r = liveParts(bs, given);
    expect(r.parts.map((p) => [p.after, p.before, p.blocks.map((b) => b.at)])).toEqual([[5, 7, ["2.0", "3.0"]], [7, 8, ["5.0"]]]);
    expect(r.after).toBe(8);
  });
  test("has no part for what was done before the first thing given, nor with nothing done", () => {
    expect(liveParts([{ at: "0.0", kind: "tool" }, ...bs.slice(0, 1), bs[3]!, bs[4]!], given).parts).toEqual([]);
    expect(liveParts([{ at: "0.0", kind: "user", text: "typed at its terminal" }, { at: "0.5", kind: "tool" }, bs[3]!], given).parts).toEqual([]);
  });
  test("leaves out what is under its last words, the parts known by the same numbers", () => {
    const r = liveParts(bs, given, { session: "s", from: 1, to: 3 });
    expect(r.parts.map((p) => [p.after, p.before, p.blocks.map((b) => b.at)])).toEqual([[5, 7, ["3.0"]], [7, 8, ["5.0"]]]);
  });
});

describe("workOf the words before", () => {
  // As recorded (2026-11-24): a stretch ends where the record had been read to as the words were
  // heard, a line before the words themselves, which are then the first of the next stretch.
  const bs = [
    { at: "100.0", kind: "tool" },
    { at: "120.0", kind: "assistant", text: "first words" },
    { at: "130.0", kind: "tool" },
    { at: "150.0", kind: "assistant", text: "second words" },
  ];
  test("are not drawn again at the head of the next stretch", () => {
    expect(workOf(bs, { session: "s", from: 110, to: 140 }, "second words", "first words").map((b) => b.at)).toEqual(["130.0"]);
  });
  test("are, when not told (what the fix passes now)", () => {
    expect(workOf(bs, { session: "s", from: 110, to: 140 }, "second words").map((b) => b.at)).toEqual(["120.0", "130.0"]);
  });
});

test("saidBefore: words said before the record had a line begin where the next ones do", () => {
  const a = { name: "far", agent: "claude" } as unknown as Msg["author"];
  const msgs: Msg[] = [
    { n: 3, text: "Looking first.", files: [], author: a, src: { session: "s", from: 0 } },
    { n: 4, text: "Found.", files: [], author: a, src: { session: "s", from: 0, to: 3865 } },
  ];
  expect(saidBefore(msgs, msgs[1]!.src!)).toBe("Looking first.");
  expect(saidBefore(msgs, msgs[0]!.src!)).toBeUndefined();
  expect(saidBefore([{ ...msgs[0]!, src: { session: "s", from: 10, to: 20 } }, { ...msgs[1]!, src: { session: "s", from: 20, to: 30 } }], { session: "s", from: 20, to: 30 })).toBe("Looking first.");
});
