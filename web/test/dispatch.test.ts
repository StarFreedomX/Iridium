// A harness's own subagent in its parent's record: which call dispatched it, which notice is
// its hand-back, the line its parent's words fold to.
import { describe, expect, test } from "vitest";
import type { Block } from "../src/api/types.gen";
import { backAt, dispatched, firstWords, handBack, launchOf, reportsOf, subFor, toldOf, tookText } from "../src/chat/dispatch";
import { folded } from "../src/chat/fold";

let n = 0;
const tool = (name: string, input: unknown, result?: string, id?: string): Block => ({ at: `${++n}.0`, kind: "tool", name, input: JSON.stringify(input), ...(id ? { id } : {}), ...(result !== undefined ? { result: { at: `${n}.r`, text: result } } : {}) });
const said = (text: string): Block => ({ at: `${++n}.0`, kind: "assistant", text });
const note = (text: string): Block => ({ at: `${++n}.0`, kind: "system", event: "task", text });
const ASYNC = (id: string) => `Async agent launched successfully.\nagentId: ${id} (internal ID - do not mention to user.)\nThe agent is working in the background.`;

describe("what a call says to a subagent", () => {
  test("Claude's Agent and Task by their description, Codex's spawn_agent by its path", () => {
    expect(toldOf({ name: "Agent", input: JSON.stringify({ description: "Web profile card", prompt: "Build it.\nThen test.", model: "haiku" }) })).toEqual({ kind: "start", name: "Web profile card", words: "Build it.\nThen test.", model: "haiku" });
    expect(toldOf({ name: "Task", input: JSON.stringify({ description: "lint", prompt: "p" }) })).toEqual({ kind: "start", name: "lint", words: "p" });
    expect(toldOf({ name: "spawn_agent", input: JSON.stringify({ agent_path: "/root/explorer" }) })).toEqual({ kind: "start", name: "/root/explorer", words: "" });
  });
  test("SendMessage by whom it is to; a Workflow, ir new and any other call are none", () => {
    expect(toldOf({ name: "SendMessage", input: JSON.stringify({ to: "ab12", summary: "s", message: "one more thing" }) })).toEqual({ kind: "send", to: "ab12", words: "one more thing" });
    expect(toldOf({ name: "SendMessage", input: "{}" })).toBeUndefined();
    expect(toldOf({ name: "Workflow", input: "{}" })).toBeUndefined();
    expect(toldOf({ name: "Bash", input: JSON.stringify({ command: "ir new claude" }) })).toBeUndefined();
  });
  test("an input cut short still names it", () => {
    expect(toldOf({ name: "Agent", input: '{"description":"Web card","prompt":"You are fin' })).toMatchObject({ kind: "start", name: "Web card", words: "You are fin" });
  });
  test("the folded line: the first line that says something, its spaces one each", () => {
    expect(firstWords("\n\n  You are   finishing\tweb work.\nSecond line")).toBe("You are finishing web work.");
    expect(firstWords("")).toBe("");
  });
});

describe("what an Agent call came back with", () => {
  test("in the background: only its id", () => {
    expect(launchOf(ASYNC("ab883a1120e7b6c49"))).toEqual({ agentId: "ab883a1120e7b6c49", background: true, report: "" });
  });
  test("with the call: its report, the id and usage lines taken off, what it used", () => {
    expect(launchOf("All done.\n\n- a\n- b\nagentId: ac53 (use SendMessage with to: 'ac53' to continue this agent)\n<usage>subagent_tokens: 14611\ntool_uses: 7\nduration_ms: 18670</usage>")).toEqual({ agentId: "ac53", background: false, report: "All done.\n\n- a\n- b", tokens: 14611, ms: 18670 });
    expect(launchOf("plain words")).toEqual({ background: false, report: "plain words" });
  });
  test("a report given as a message of its own is not in the result", () => {
    expect(launchOf('  This agent\'s report was delivered to you as a message from "ac53" (its SubagentHandback call). Read it there; it is not repeated here.\n\nagentId: ac53 (use SendMessage)\n<usage>total_tokens: 9\nduration_ms: 61000</usage>')).toEqual({ agentId: "ac53", background: false, report: "", tokens: 9, ms: 61000 });
  });
  test("a span as the notice says it", () => {
    expect([tookText(18_670), tookText(1_405_480), tookText(4_330_000)]).toEqual(["19s", "23m", "1h 12m"]);
  });
});

describe("a task's notice as a hand-back", () => {
  test("a subagent's: its name, how long; a workflow's or any other line is none", () => {
    expect(handBack('Agent "Web profile card and menus" finished · 23m')).toEqual({ name: "Web profile card and menus", failed: false, took: "23m" });
    expect(handBack('Agent "say "hi" twice" completed')).toEqual({ name: 'say "hi" twice', failed: false });
    expect(handBack('Agent "x" failed · 4s')).toEqual({ name: "x", failed: true, took: "4s" });
    expect(handBack('Workflow "Fix the caret" completed · 9 agents · 36m')).toBeUndefined();
    expect(handBack("Task killed · 1 agent · 4s")).toBeUndefined();
  });
});

describe("which dispatch a block is about", () => {
  test("a notice goes with the dispatch of its name; two of one name each get one, in order", () => {
    const a = tool("Agent", { description: "same", prompt: "one" }, ASYNC("a1"), "t1");
    const b = tool("Agent", { description: "same", prompt: "two" }, ASYNC("b2"), "t2");
    const other = tool("Agent", { description: "other", prompt: "three" }, ASYNC("c3"), "t3");
    const n1 = note('Agent "same" finished · 1m');
    const n2 = note('Agent "other" finished · 2m');
    const n3 = note('Agent "same" finished · 3m');
    const d = dispatched(folded([a, b, other, said("waiting"), n1, n2, n3, said("done")]));
    expect(d.starts.map((s) => [s.id, s.agentId, s.background])).toEqual([["t1", "a1", true], ["t2", "b2", true], ["t3", "c3", true]]);
    expect([n1, n2, n3].map((x) => d.of.get(x.at)?.id)).toEqual(["t1", "t3", "t2"]);
  });
  test("SendMessage by the id the call's result named; one woken again hands back again", () => {
    const a = tool("Agent", { description: "build", prompt: "go" }, ASYNC("a1"), "t1");
    const n1 = note('Agent "build" finished · 1m');
    const more = tool("SendMessage", { to: "a1", message: "also the tests" }, "ok");
    const n2 = note('Agent "build" finished · 2m');
    const d = dispatched(folded([a, said("x"), n1, more, said("y"), n2, said("z")]));
    expect(d.of.get(more.at)?.id).toBe("t1");
    expect(d.of.get(n2.at)?.id).toBe("t1");
    const s = d.starts[0]!;
    expect([backAt(s, n1.at), backAt(s, n2.at)]).toEqual([{ total: 2, fromLast: 1 }, { total: 2, fromLast: 0 }]);
  });
  test("a call that came back with its report is the first hand-back; a notice with no dispatch on the page goes with none", () => {
    const a = tool("Agent", { description: "look", prompt: "go" }, "found it\nagentId: a9 (use SendMessage)", "t1");
    const again = tool("SendMessage", { to: "a9", message: "and this" }, "ok");
    const n1 = note('Agent "look" finished · 5s');
    const lost = note('Agent "long ago" finished · 5s');
    const d = dispatched(folded([a, again, said("x"), n1, lost, said("y")]));
    const s = d.starts[0]!;
    expect(s.background).toBe(false);
    expect([backAt(s, a.at), backAt(s, n1.at)]).toEqual([{ total: 2, fromLast: 1 }, { total: 2, fromLast: 0 }]);
    expect(d.of.has(lost.at)).toBe(false);
  });
  test("a call to a subagent is a line of its own, never folded with other steps", () => {
    const shown = folded([tool("Bash", { command: "ls" }, "ok"), tool("SendMessage", { to: "a1", message: "hi" }, "ok"), tool("Read", { file_path: "/a" }, "ok"), said("done")]);
    expect(shown.map((b) => (b.kind === "fold" ? b.steps.map((s) => s.name) : b.kind))).toEqual([["Bash"], ["SendMessage"], ["Read"], "assistant"]);
  });
});

describe("the subagent's session of a dispatch", () => {
  const subs = [{ id: "s1", title: "same", call: "t1" }, { id: "s2", title: "same", call: "t2" }, { id: "s3", title: "/root/explorer" }];
  test("by the call that started it, else by its title", () => {
    expect(subFor({ id: "t2", name: "same" }, subs)?.id).toBe("s2");
    expect(subFor({ name: "/root/explorer" }, subs)?.id).toBe("s3");
    expect(subFor({ id: "gone", name: "same" }, subs)?.id).toBe("s2");
    expect(subFor({ id: "t9", name: "none" }, subs)).toBeUndefined();
  });
});

describe("what a subagent handed back, in its own record", () => {
  test("each SubagentHandback's message; with none, its last words", () => {
    const first = tool("SubagentHandback", { message: "first report" }, "ok");
    const second: Block = { ...tool("SubagentHandback", { message: "second report, long" }), length: 9000 };
    expect(reportsOf([said("working"), first, said("more"), second])).toEqual([
      { at: first.at, text: "first report", tool: true },
      { at: second.at, text: "second report, long", tool: true, length: 9000 },
    ]);
    const last = said("the answer");
    expect(reportsOf([said("thinking aloud"), tool("Bash", { command: "ls" }, "ok"), last])).toEqual([{ at: last.at, text: "the answer", tool: false }]);
    expect(reportsOf([])).toEqual([]);
  });
});
