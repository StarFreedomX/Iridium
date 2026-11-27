// What an agent was given, read into the sections of its <channel-context>: every character kept.
import { describe, expect, test } from "vitest";
import { givenJoined, givenOf, headsOf, parseGiven } from "../src/chat/given";

const STANDING = `You are codex in a channel shared with people and other agents. Its agents: claude, codex. Only what you say reaches the channel.
Besides @, an agent wakes only on what its line above says; any member may change it: ir api help wake.
`;
const FULL_9 = `#9 [claude · 01-01 01:00 · bash 7 (go 4, git 3), 1 failed]: done

#10 [kumo · 01-01 01:05]: not a line
Work since you last read the channel
`;
const TEXT =
  "[kumo] #11: [answering #3 ann: the words] @codex look\n\n<channel-context>\n" +
  STANDING +
  "#1–#4: 4 earlier messages, not shown.\n" +
  "Listed by turn (who asked, their first words, who answered):\n" +
  "#5–#8 kumo: fix the build (answered by claude)\n" +
  "In full, what was said since you last read the channel:\n" +
  FULL_9 +
  "#10 [kumo · 01-01 01:01]: long […7 more characters: ir api message.get channel_id=self message_id=10]\n" +
  "Work since you last read the channel (tool calls counted; files as changed by editing tools, not by shell commands):\n" +
  "claude: bash 7 (go 4, git 3), 1 failed — /w/a.go, /w/b.go\n" +
  "More of the channel: ir api message.list channel_id=self [next=<number> limit=<n>].\n" +
  "React to a message rather than answer it in words: ir api reaction.create channel_id=self message_id=<number> emoji=👍.\n" +
  "</channel-context>\nSession title: none yet";

const PARTS = {
  kind: "turn-prefix",
  text: TEXT,
  parts: [
    { source: "prompts:channel.context.turn", values: { from: "5", to: "8", who: "kumo", head: "fix the build" } },
    { source: "prompts:channel.context.line", values: { seq: "9", who: "claude", time: "01-01 01:00" } },
    { source: "prompts:channel.context.line", values: { seq: "10", who: "kumo", time: "01-01 01:01" } },
  ],
};

describe("a channel's message as given", () => {
  test("its sections, in order, joined back to the text", () => {
    const heads = headsOf(PARTS);
    expect(heads).toEqual(["#5–#8 kumo: ", "#9 [claude · 01-01 01:00", "#10 [kumo · 01-01 01:01"]);
    const g = parseGiven(TEXT, heads)!;
    expect(givenJoined(g)).toBe(TEXT);
    expect(g.head).toBe("[kumo] #11: [answering #3 ann: the words] @codex look");
    expect(g.after).toBe("\nSession title: none yet");
    expect(g.sections.map((s) => s.kind)).toEqual(["about", "new", "work", "cmds"]);
    expect(g.sections[0]!.raw).toBe(STANDING);
    const lines = g.sections[1]!.rows.filter((r) => r.kind === "line");
    expect(lines.map((r) => (r.kind === "line" ? [r.head, r.words] : []))).toEqual([
      ["#5–#8 kumo: ", "fix the build (answered by claude)\n"],
      ["#9 [claude · 01-01 01:00 · bash 7 (go 4, git 3), 1 failed]: ", "done\n\n#10 [kumo · 01-01 01:05]: not a line\nWork since you last read the channel\n"],
      ["#10 [kumo · 01-01 01:01]: ", "long […7 more characters: ir api message.get channel_id=self message_id=10]\n"],
    ]);
    expect(g.sections[3]!.raw.startsWith("More of the channel: ")).toBe(true);
  });
  test("without its parts, by the lines' looks: still every character", () => {
    const g = parseGiven(TEXT)!;
    expect(givenJoined(g)).toBe(TEXT);
    expect(g.sections[1]!.rows.filter((r) => r.kind === "line").length).toBeGreaterThanOrEqual(3);
  });
  test("heads that are not there: read by the looks", () => {
    const g = parseGiven(TEXT, ["#99 [x · 01-01 00:00"])!;
    expect(givenJoined(g)).toBe(TEXT);
  });
  test("the brief kind, and text it cannot read", () => {
    const brief = "#12: hi\n\n<channel-context>\nIn the channel \"Room\" (ch-1), as before.\n</channel-context>";
    const g = parseGiven(brief)!;
    expect(givenJoined(g)).toBe(brief);
    expect(g.sections.map((s) => [s.kind, s.raw])).toEqual([["about", 'In the channel "Room" (ch-1), as before.\n']]);
    expect(parseGiven("[kumo] #69: words alone")).toBeNull();
    for (const odd of ["#1: a\n\n<channel-context>\n</channel-context>", "#1: a\n\n<channel-context>\nno end", "x\n\n<channel-context>\nIn full, what was said since you last read the channel:\nweird\n</channel-context>tail"]) {
      const p = parseGiven(odd);
      if (p) expect(givenJoined(p)).toBe(odd);
    }
  });
});

describe("what a session was given", () => {
  test("by input, the latest for each; its system prompt; verbatim only with a channel's turn", () => {
    const list = [
      { id: 3, at: 3, input: "b", record: { kind: "message", text: "[网页] again" } },
      { id: 2, at: 2, input: "b", record: { kind: "message", text: "[网页] old" } },
      { id: 1, at: 1, record: { kind: "system", text: "SYS" } },
    ];
    const plain = givenOf(list);
    expect(plain.verbatim).toBe(false);
    expect(plain.system).toBe("SYS");
    expect(plain.byInput.get("b")?.text).toBe("[网页] again");
    const member = givenOf([{ id: 4, at: 4, input: "c", seq: 11, record: PARTS }, ...list]);
    expect(member.verbatim).toBe(true);
    expect(member.byInput.get("c")?.heads.length).toBe(3);
  });
});
