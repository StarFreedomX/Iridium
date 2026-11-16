// A harness's own subagent as a person dispatched to work (kumo, 2026-11-16: 劳务派遣, 也算个人的):
// what its parent's record holds of it. Claude's Agent (Task) call starts one, its SendMessage
// speaks to it again, its result or a task's notice ("Agent "…" finished · 23m") is what it
// hands back; Codex's spawn_agent starts one and records no more. Pure, for tests.
import type { Block } from "../api/types.gen";
import type { Shown } from "./fold";
import { partialInput } from "./partial";

type Call = { name?: string; input?: string };

/** A call's input as an object; one cut short (Block.length), its string fields as far as they
 *  go: a long prompt's start is still its words. */
function fieldsOf(input = ""): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(input);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return partialInput(input);
  }
}

/** What a call says to a subagent: start, it is dispatched (name: its task as the call names
 *  it, Codex's its path); send, words to one at work or back (to: its id, or its name). */
export type Told = { kind: "start"; name: string; words: string; model?: string } | { kind: "send"; to: string; words: string };

/** A Workflow's run and ir new's session are no subagent of the harness: undefined, as any
 *  other call. */
export function toldOf(c: Call): Told | undefined {
  const name = (c.name ?? "").toLowerCase();
  if (name !== "agent" && name !== "task" && name !== "spawn_agent" && name !== "sendmessage") return undefined;
  const i = fieldsOf(c.input);
  const str = (...ks: string[]) => ks.map((k) => i[k]).find((v): v is string => typeof v === "string" && v !== "") ?? "";
  if (name === "sendmessage") {
    const to = str("to", "recipient");
    return to ? { kind: "send", to, words: str("message", "content") } : undefined;
  }
  if (name === "spawn_agent") return { kind: "start", name: str("agent_path", "nickname"), words: str("prompt", "message") };
  const model = str("model");
  return { kind: "start", name: str("description", "name", "subagent_type"), words: str("prompt"), ...(model ? { model } : {}) };
}

/** A line of words: the first that says something, its spaces one each. */
export const firstWords = (words: string) => (words.split("\n").find((l) => l.trim()) ?? "").replace(/\s+/g, " ").trim();

/** What Claude's Agent call came back with: background, it only started (what it hands back
 *  comes as a task's notice); else report, its last words ("" when Claude gave them to the
 *  agent as a message of their own, which the record's page does not hold), with what it used. */
export type Launch = { agentId?: string; background: boolean; report: string; tokens?: number; ms?: number };

export function launchOf(text = ""): Launch {
  const agentId = /^agentId: ([\w-]+)/m.exec(text)?.[1];
  const background = /^Async agent launched/.test(text);
  const usage = /<usage>([\s\S]*?)<\/usage>\s*$/.exec(text)?.[1] ?? "";
  const num = (k: string) => {
    const n = Number(new RegExp(`(?:^|\\n)\\s*${k}: (\\d+)`).exec(usage)?.[1]);
    return n > 0 ? n : undefined;
  };
  const tokens = num("subagent_tokens") ?? num("total_tokens");
  const ms = num("duration_ms");
  const said = background ? "" : text.replace(/\n?agentId: [^\n]*(?:\n<usage>[\s\S]*?<\/usage>)?\s*$/, "").replace(/\s*<usage>[\s\S]*?<\/usage>\s*$/, "");
  const report = /^\s*This agent's report was delivered to you as a message/.test(said) ? "" : said.trim();
  return { ...(agentId ? { agentId } : {}), background, report, ...(tokens ? { tokens } : {}), ...(ms ? { ms } : {}) };
}

/** A span as the task's notice says it (transcript.go took): 45s, 3m, 1h 12m. */
export const tookText = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m` : `${Math.floor(ms / 3_600_000)}h ${Math.floor(ms / 60_000) % 60}m`);

/** A task's notice as a subagent's hand-back: its task's name, whether it failed (stopped,
 *  killed), how long it took. A workflow's notice, or any other line, is none. */
export function handBack(text = ""): { name: string; failed: boolean; took?: string } | undefined {
  const m = /^Agent "(.*)" ([a-z][a-z ]*?)(?: · (.+))?$/.exec(text.trim());
  if (!m) return undefined;
  return { name: m[1]!, failed: /fail|kill|stop|error/.test(m[2]!), ...(m[3] ? { took: m[3].split(" · ").at(-1)! } : {}) };
}

/** A subagent's dispatch in its parent's record: at, the call's block; id, the call's
 *  (Session.call); back, the blocks it handed back at after the call's own result, in order. */
export type Start = { at: string; id?: string; name: string; model?: string; agentId?: string; background: boolean; back: string[] };

/** starts: the dispatches on the page, in order. of: the dispatch a block is about, by the
 *  block's place: the call itself, a SendMessage to it, a notice of its hand-back. */
export type Dispatched = { starts: Start[]; of: Map<string, Start> };

/** Each SendMessage goes with the dispatch whose result named its id (else the one named as it
 *  is addressed); each notice with the dispatch before it of its name: the first that has
 *  handed nothing back yet (two of one name each get one), else the last (one woken again
 *  hands back again). One whose dispatch is not on the page goes with none. */
export function dispatched(blocks: Shown[]): Dispatched {
  const starts: Start[] = [];
  const of = new Map<string, Start>();
  const tool = (b: Block) => {
    const told = toldOf(b);
    if (told?.kind === "start") {
      const l = b.result && !b.result.error ? launchOf(b.result.text) : undefined;
      const s: Start = { at: b.at, ...(b.id ? { id: b.id } : {}), name: told.name, ...(told.model ? { model: told.model } : {}), ...(l?.agentId ? { agentId: l.agentId } : {}), background: !!l?.background, back: [] };
      starts.push(s);
      of.set(b.at, s);
    } else if (told) {
      const s = starts.findLast((x) => x.agentId === told.to) ?? starts.findLast((x) => x.name === told.to);
      if (s) of.set(b.at, s);
    }
  };
  for (const b of blocks) {
    if (b.kind === "fold") for (const s of b.steps) if (s.kind === "tool") tool(s);
    if (b.kind === "running") tool(b.tool);
    if (b.kind !== "system" || b.event !== "task") continue;
    const h = handBack(b.text);
    const named = h ? starts.filter((x) => x.name === h.name) : [];
    const s = named.find((x) => x.background && !x.back.length) ?? named.at(-1);
    if (!s) continue;
    s.back.push(b.at);
    of.set(b.at, s);
  }
  return { starts, of };
}

/** How many times a dispatch has handed back on the page, and which of them, counted from the
 *  last (0), the one at block at is (the call's own result: the first). */
export function backAt(s: Start, at: string): { total: number; fromLast: number } {
  const own = s.background ? 0 : 1;
  const i = at === s.at ? 0 : s.back.indexOf(at) + own;
  const total = s.back.length + own;
  return { total, fromLast: total - 1 - i };
}

/** The subagent's session of a dispatch: by the call that started it (Session.call, Claude's),
 *  else the latest whose title is the dispatch's name (Claude: the call's description; Codex:
 *  the agent's path). */
export function subFor<S extends { title?: string; call?: string }>(of: { id?: string; name: string }, subs: S[]): S | undefined {
  return (of.id ? subs.find((s) => s.call === of.id) : undefined) ?? (of.name ? subs.findLast((s) => !s.call && s.title === of.name) ?? subs.findLast((s) => s.title === of.name) : undefined);
}

/** What a subagent handed back, as its own record has it, in order: each SubagentHandback
 *  call's message (Claude); with none, its last words. cut: the page has only its start (length:
 *  the whole's); tool: it is a call's input. */
export type Report = { at: string; text: string; tool: boolean; length?: number };

export function reportsOf(blocks: Block[]): Report[] {
  const cut = (b: Block) => (b.length ? { length: b.length } : {});
  const out = blocks.flatMap((b): Report[] => {
    if (b.kind !== "tool" || (b.name ?? "").toLowerCase() !== "subagenthandback") return [];
    const text = messageOf(b.input);
    return text ? [{ at: b.at, text, tool: true, ...cut(b) }] : [];
  });
  if (out.length) return out;
  const last = blocks.findLast((b) => b.kind === "assistant" && !!b.text?.trim());
  return last ? [{ at: last.at, text: last.text!, tool: false, ...cut(last) }] : [];
}

/** A SubagentHandback call's message, from its input (whole, or cut short). */
export function messageOf(input = ""): string {
  const m = fieldsOf(input).message;
  return typeof m === "string" ? m : "";
}
