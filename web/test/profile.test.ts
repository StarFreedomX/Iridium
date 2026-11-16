// Cards (docs/next/group.md "资料卡", "改资料"): what a face or a background may be given as,
// an agent's menu as a list, the line a changed card leaves in a channel.
import { describe, expect, test } from "vitest";
import { eventParts, type EventWords } from "../src/chat/channel/lib";
import { memberMenu } from "../src/chat/channel/menu";
import { COLOURS, EMOJI, emojiOf, faceKind, isColour, isEmoji } from "../src/facevalue";

describe("a face's value", () => {
  test("a colour: #rgb or #rrggbb", () => {
    expect(isColour("#2f4f6f")).toBe(true);
    expect(isColour("#ABC")).toBe(true);
    expect(isColour("2f4f6f")).toBe(false);
    expect(isColour("#2f4f6")).toBe(false);
    expect(COLOURS.every(isColour)).toBe(true);
  });
  test("one emoji: one character as read, however many code points", () => {
    expect(isEmoji("🧪")).toBe(true);
    expect(isEmoji("🛠️")).toBe(true);
    expect(isEmoji("👩‍💻")).toBe(true);
    expect(isEmoji("🇯🇵")).toBe(true);
    expect(isEmoji("🧪🧪")).toBe(false);
    expect(isEmoji("a")).toBe(false);
    expect(isEmoji("猫")).toBe(false);
    expect(isEmoji("")).toBe(false);
    // A keycap has an ASCII digit in it: the server takes none.
    expect(isEmoji("1️⃣")).toBe(false);
    expect(EMOJI.every(isEmoji)).toBe(true);
  });
  test("typed into a field: the last character, if it is an emoji", () => {
    expect(emojiOf("🙂")).toBe("🙂");
    expect(emojiOf("ab🦊 ")).toBe("🦊");
    expect(emojiOf("🦊a")).toBe("");
    expect(emojiOf("")).toBe("");
  });
  test("what a value is", () => {
    expect(faceKind("")).toBe("none");
    expect(faceKind("  ")).toBe("none");
    expect(faceKind("data:image/png;base64,AAAA")).toBe("image");
    expect(faceKind("#2f4f6f")).toBe("colour");
    expect(faceKind("🧪")).toBe("emoji");
    expect(faceKind("data:text/html;base64,AAAA")).toBeUndefined();
    expect(faceKind("hello")).toBeUndefined();
  });
});

describe("an agent's menu", () => {
  const all = { may: true, own: false, call: true, models: 3, levels: 3, modes: 2, busy: true, session: true };
  const keys = (x: Parameters<typeof memberMenu>[0]) => memberMenu(x).map((i) => i.key);
  test("all of it, in order", () => {
    expect(keys(all)).toEqual(["call", "compact", "clear", "model", "effort", "mode", "stop", "recv", "edit", "session", "given", "remove"]);
  });
  test("what it has none of is left out: one model, one level, one mode, at rest", () => {
    expect(keys({ ...all, models: 0, levels: 1, modes: 1, busy: false })).toEqual(["call", "compact", "clear", "recv", "edit", "session", "given", "remove"]);
  });
  test("the channel's own agent: 移出 shown, not offered", () => {
    const m = memberMenu({ ...all, own: true, session: false });
    expect(m.at(-1)).toEqual({ key: "remove", disabled: true });
    expect(m.map((i) => i.key)).not.toContain("session");
    expect(memberMenu(all).at(-1)).toEqual({ key: "remove" });
  });
  test("one who only reads: what reads", () => {
    expect(keys({ ...all, may: false, call: false })).toEqual(["session", "given"]);
  });
});

describe("a changed card's line", () => {
  const w = {
    by: "（{by}）",
    profile: "{by} 更新了 {nick} 的资料：{what}",
    profileChannel: "{by} 更新了频道资料：{what}",
    profileNoBy: "{nick} 的资料已更新：{what}",
    profileChannelNoBy: "频道资料已更新：{what}",
    what: { name: "名称", intro: "介绍", avatar: "头像", background: "背景" },
    whatSep: "、",
  } as unknown as EventWords;
  test("a member's: who, whose, what", () => {
    expect(eventParts({ type: "profile", member: "agent:s", nick: "pi2", what: ["intro", "avatar"], by: "kumo" }, w)).toEqual(["kumo 更新了 ", { nick: "pi2" }, " 的资料：介绍、头像"]);
    expect(eventParts({ type: "profile", member: "agent:s", nick: "pi2", what: ["background"], by: "主机" }, w)).toEqual(["Iridium 更新了 ", { nick: "pi2" }, " 的资料：背景"]);
  });
  test("the channel's own", () => {
    expect(eventParts({ type: "profile", what: ["name"], by: "kumo" }, w)).toEqual(["kumo 更新了频道资料：名称"]);
  });
  test("by no one known: the same without", () => {
    expect(eventParts({ type: "profile", member: "agent:s", nick: "pi2", what: ["intro"] }, w)).toEqual([{ nick: "pi2" }, " 的资料已更新：介绍"]);
    expect(eventParts({ type: "profile", what: ["avatar", "later"] }, w)).toEqual(["频道资料已更新：头像、later"]);
  });
  test("nothing changed, or words not given: its own text is shown", () => {
    expect(eventParts({ type: "profile", nick: "pi2", by: "kumo" }, w)).toBeUndefined();
    expect(eventParts({ type: "profile", what: ["name"], by: "kumo" }, { by: "" } as unknown as EventWords)).toBeUndefined();
  });
});
