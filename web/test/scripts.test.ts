// A channel's subscriptions and commands, what the page reads and writes of them (src/chat/channel/scripts.ts).
import { describe, expect, test } from "vitest";
import { asName, blankTrigger, cronReading, dailyCron, draftOf, onOf, recvLabel, recvOf, recvWhole, scriptOfUser, scriptRefusal, splitWords, toggle, triggerLine, triggerOf, type CronWords, type TriggerWords } from "../src/chat/channel/scripts";

const names: Record<string, string> = { "ir_web/a": "kumo", "bot/*": "QQ", "agent:s2": "@codex", "agent:s3": "@pi" };
const nameOf = (e: string) => names[e] ?? e;
const rw = { at: "仅被 @ 时", all: "全体成员", sep: "、", n: "{n} 项" };
const cw: CronWords = { minute: "每分钟", everyMin: "每 {n} 分钟", hourly: "每小时第 {m} 分", everyHour: "每 {n} 小时", daily: "每天 {t}", weekdays: "工作日 {t}", weekly: "每{d} {t}", monthly: "每月 {n} 日 {t}", days: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"], sep: "、" };
const tw: TriggerWords = { said: "{from}说话时", saidWords: "{from}说到{words}时", words: "说到{words}时", any: "有消息时", quote: "「{w}」", or: "或", command: "发送 /{name} 时", cron: "{when}", event: "{events}时", events: { join: "成员加入", leave: "成员移出", wake: "唤醒变更" }, then: "{line} → {text}", sep: "、", recv: { all: "全体成员" }, when: cw };

describe("receive sets", () => {
  test("read: a list as it is, the old words as sets", () => {
    expect(recvOf(["*", "agent:s2"])).toEqual(["*", "agent:s2"]);
    expect(recvOf("all")).toEqual(["*"]);
    expect(recvOf("at")).toEqual([]);
    expect(recvOf(undefined)).toEqual([]);
  });
  test("in a few words: none, every person, names that fit, else how many", () => {
    expect(recvLabel([], nameOf, rw)).toBe("仅被 @ 时");
    expect(recvLabel(["*"], nameOf, rw)).toBe("全体成员");
    expect(recvLabel(["*", "agent:s2"], nameOf, rw)).toBe("全体成员、@codex");
    expect(recvLabel(["*", "agent:s2", "agent:s3"], nameOf, rw)).toBe("3 项");
    expect(recvLabel(["agent:s2", "a-very-long-login/name"], nameOf, rw)).toBe("2 项");
  });
  test("whole, for an event's line", () => {
    expect(recvWhole([], nameOf, rw)).toBe("仅被 @ 时");
    expect(recvWhole(["*", "bot/*", "agent:s2", "agent:s3"], nameOf, rw)).toBe("全体成员、QQ、@codex、@pi");
  });
  test("an entry pressed in, pressed out", () => {
    expect(toggle(["*"], "agent:s2")).toEqual(["*", "agent:s2"]);
    expect(toggle(["*", "agent:s2"], "*")).toEqual(["agent:s2"]);
  });
});

describe("a cron line read", () => {
  test("a time of day as a line each day", () => {
    expect(dailyCron("09:05")).toBe("5 9 * * *");
    expect(dailyCron("24:00")).toBeUndefined();
  });
  test("the simple ones", () => {
    expect(cronReading("* * * * *", cw)).toBe("每分钟");
    expect(cronReading("*/15 * * * *", cw)).toBe("每 15 分钟");
    expect(cronReading("5 * * * *", cw)).toBe("每小时第 5 分");
    expect(cronReading("0 */2 * * *", cw)).toBe("每 2 小时");
    expect(cronReading("0 9 * * *", cw)).toBe("每天 09:00");
    expect(cronReading(" 30  18 * * * ", cw)).toBe("每天 18:30");
    expect(cronReading("0 9 * * 1-5", cw)).toBe("工作日 09:00");
    expect(cronReading("0 9 * * 1,3", cw)).toBe("每周一、周三 09:00");
    expect(cronReading("0 9 * * 7", cw)).toBe("每周日 09:00");
    expect(cronReading("0 9 1 * *", cw)).toBe("每月 1 日 09:00");
  });
  test("the rest: none", () => {
    expect(cronReading("0 9 * 1 *", cw)).toBeUndefined();
    expect(cronReading("0 25 * * *", cw)).toBeUndefined();
    expect(cronReading("0 9-17 * * *", cw)).toBeUndefined();
    expect(cronReading("0 9 * *", cw)).toBeUndefined();
  });
});

describe("a trigger in words", () => {
  test("each kind in a sentence", () => {
    expect(triggerLine({ message: { from: ["*"] } }, nameOf, tw)).toBe("全体成员说话时");
    expect(triggerLine({ message: { from: ["*"], words: ["小克"] } }, nameOf, tw)).toBe("全体成员说到「小克」时");
    expect(triggerLine({ message: { words: ["a", "b"] } }, nameOf, tw)).toBe("说到「a」或「b」时");
    expect(triggerLine({ message: { from: ["ir_web/a", "agent:s2"] } }, nameOf, tw)).toBe("kumo、@codex说话时");
    expect(triggerLine({ message: {} }, nameOf, tw)).toBe("有消息时");
    expect(triggerLine({ command: "echo" }, nameOf, tw)).toBe("发送 /echo 时");
    expect(triggerLine({ cron: "0 9 * * *" }, nameOf, tw)).toBe("每天 09:00");
    expect(triggerLine({ cron: "0 9-17 * * *" }, nameOf, tw)).toBe("0 9-17 * * *");
    expect(triggerLine({ event: ["join", "leave"] }, nameOf, tw)).toBe("成员加入或成员移出时");
    expect(triggerLine({ event: ["people", "join", "recv"], text: "欢迎新人" }, nameOf, tw)).toBe("成员加入或唤醒变更时 → 欢迎新人");
  });
  test("as the editor holds it, and back: the kind's fields alone", () => {
    const d = draftOf({ message: { from: ["*"], words: ["a", "b"] } });
    expect(d).toMatchObject({ kind: "message", from: ["*"], words: "a b" });
    expect(triggerOf({ ...d, words: "a，b、c" })).toEqual({ message: { from: ["*"], words: ["a", "b", "c"] } });
    expect(triggerOf({ ...blankTrigger("message") })).toEqual({ message: {} });
    expect(triggerOf({ ...blankTrigger("command"), command: "/echo " })).toEqual({ command: "echo" });
    expect(triggerOf({ ...blankTrigger("cron"), cron: " 0  9 * * * " })).toEqual({ cron: "0 9 * * *" });
    expect(triggerOf({ ...draftOf({ event: ["join"] }), from: ["*"] })).toEqual({ event: ["join"] });
    expect(triggerOf(draftOf({ event: ["people"], text: " hi " }))).toEqual({ event: ["join"], text: "hi" });
  });
});

describe("scripts", () => {
  test("a message's script, by its user or its _data", () => {
    expect(scriptOfUser("script:echo")).toBe("echo");
    expect(scriptOfUser("iridium", "echo")).toBe("echo");
    expect(scriptOfUser("agent:s1")).toBeUndefined();
    expect(scriptOfUser(undefined)).toBeUndefined();
  });
  test("words split, a name as a nick is written", () => {
    expect(splitWords(" a, b，c、d  e ")).toEqual(["a", "b", "c", "d", "e"]);
    expect(asName("x".repeat(40))).toHaveLength(32);
  });
  test("why the server refused one", () => {
    expect(scriptRefusal(409, "name taken")).toBe("taken");
    expect(scriptRefusal(400, "on.cron: bad field")).toBe("cron");
    expect(scriptRefusal(422, "on[1].event \"x\": of join leave")).toBe("event");
    expect(scriptRefusal(422, "on[0].message.from: a list of")).toBe("from");
    expect(scriptRefusal(422, "on: at least one: {message}")).toBe("on");
    expect(scriptRefusal(400, "name: letters, digits, _ and -, at most 32")).toBe("name");
    expect(scriptRefusal(400, "scripts run at the host: this channel's folder is at another computer")).toBe("away");
    expect(scriptRefusal(500, "boom")).toBeUndefined();
  });
});

describe("an agent's subscriptions", () => {
  test("read: a list as it is, none as none", () => {
    expect(onOf([{ message: { from: ["*"] } }])).toEqual([{ message: { from: ["*"] } }]);
    expect(onOf(undefined)).toEqual([]);
  });
});
