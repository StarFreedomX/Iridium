// 群聊配置's own reckoning (src/chat/channel/setup.ts): the people as member strings, a new
// session's draft as the ChannelSetup it is made with, the key's count, who may act.
import { describe, expect, test } from "vitest";
import type { ChannelMembers } from "../src/api/types.gen";
import { mayAct } from "../src/chat/channel/gate";
import { everyone, hasApp, hasLogin, keepMe, pressApp, pressLogin, peopleOf, setApp, setLogin } from "../src/chat/channel/setup";

const ME = "ir_web/me";

describe("a channel's people", () => {
  test("everyone: none named, or * among them", () => {
    expect(everyone([])).toBe(true);
    expect(everyone(["*"])).toBe(true);
    expect(everyone(["ir_web/a", "*"])).toBe(true);
    expect(everyone(["ir_web/a"])).toBe(false);
  });
  test("read from the members: those that are no agent's", () => {
    const m = { members: [{ member: "*", recv: "all" }, { member: "agent:s1", session: "s1", recv: "all" }, { member: "ir_web/a", recv: "all" }] } as ChannelMembers;
    expect(peopleOf(m)).toEqual(["*", "ir_web/a"]);
    expect(peopleOf(undefined)).toEqual([]);
  });
  test("who is in: a login named, or its app's all", () => {
    expect(hasLogin(["ir_web/a"], "ir_web", "a")).toBe(true);
    expect(hasLogin(["ir_web/a"], "ir_web", "b")).toBe(false);
    expect(hasLogin(["ir_web/*"], "ir_web", "b")).toBe(true);
    expect(hasLogin(["*"], "bot", "x")).toBe(true);
    expect(hasApp(["ir_web/a"], "ir_web")).toBe(false);
    expect(hasApp(["ir_web/*"], "ir_web")).toBe(true);
  });
  test("the one looking stays in", () => {
    expect(keepMe(["bot/*"], ME)).toEqual(["bot/*", ME]);
    expect(keepMe([ME], ME)).toEqual([ME]);
    expect(keepMe(["ir_web/*"], ME)).toEqual(["ir_web/*"]);
    expect(keepMe(["*"], ME)).toEqual(["*"]);
    expect(keepMe(["bot/*"], undefined)).toEqual(["bot/*"]);
  });
  test("an app's tick: on, its single logins go; off, none of it stays but me", () => {
    expect(setApp([ME, "ir_web/b"], "ir_web", true, ME)).toEqual(["ir_web/*"]);
    expect(setApp(["ir_web/*", "bot/*"], "ir_web", false, ME)).toEqual(["bot/*", ME]);
    expect(setApp([ME], "bot", true, ME)).toEqual([ME, "bot/*"]);
    expect(setApp(["*"], "bot", true, ME)).toEqual(["bot/*", ME]);
  });
  test("a login's tick: off under its app's all, the others are named; me never off", () => {
    expect(setLogin([ME], "ir_web", "b", true, ["me", "b"], ME)).toEqual([ME, "ir_web/b"]);
    expect(setLogin([ME, "ir_web/b"], "ir_web", "b", false, ["me", "b"], ME)).toEqual([ME]);
    expect(setLogin(["ir_web/*"], "ir_web", "b", false, ["me", "b", "c"], ME)).toEqual(["ir_web/me", "ir_web/c"]);
    expect(setLogin(["ir_web/*"], "ir_web", "b", true, ["me", "b"], ME)).toEqual(["ir_web/*"]);
    expect(setLogin([ME], "ir_web", "me", false, ["me", "b"], ME)).toEqual([ME]);
  });
  test("who may act: all but one the members say is not of its people", () => {
    expect(mayAct(undefined)).toBe(true);
    expect(mayAct({ joined: true })).toBe(true);
    expect(mayAct({ joined: false })).toBe(false);
  });
});

describe("the new session's chips", () => {
  const apps = ["ir_web", "koishi"];
  const logins: Record<string, string[]> = { ir_web: ["me", "u2"], koishi: ["bot1", "u2"] };
  const of = (a: string) => logins[a] ?? [];
  const me = "ir_web/me";
  test("one unlit from everyone leaves the rest lit", () => {
    expect(pressLogin(["*"], apps, of, "koishi", "bot1", me).sort()).toEqual(["ir_web/*", "koishi/u2"]);
  });
  test("lit again, everyone again", () => {
    expect(pressLogin(["ir_web/*", "koishi/u2"], apps, of, "koishi", "bot1", me)).toEqual(["*"]);
  });
  test("me stays lit", () => {
    expect(pressLogin(["*"], apps, of, "ir_web", "me", me)).toEqual(["*"]);
    expect(pressApp(["*"], apps, of, "ir_web", me).sort()).toEqual(["ir_web/me", "koishi/*"]);
  });
  test("an app's all, on and off", () => {
    const one = pressApp(["*"], apps, of, "koishi", me);
    expect(one.sort()).toEqual(["ir_web/*"]);
    expect(pressApp(one, apps, of, "koishi", me)).toEqual(["*"]);
  });
  test("an app's logins all lit one by one are its all", () => {
    expect(pressLogin(["ir_web/me", "koishi/*"], apps, of, "ir_web", "u2", me)).toEqual(["*"]);
  });
});
