// One page for a session, one agent or several (kumo, 2026-11-15: 会话页不换页，多一个 agent 只是
// 多一个成员): the own agent's record as its chat draws it, and what its channel's log has that the
// record does not, each in its place by time. Pure: chat.tsx draws what these say.
import type { Msg } from "./lib";

/** The log's messages the record does not hold: not the own agent's (its words are its record's),
 *  not a person's it was given (the record has the input, by its id) or that was read from it, not those before the record's
 *  first block as far as it is loaded (since: none when the record is loaded to its start). */
export function foreignOf(msgs: Msg[], own: string, inputs: ReadonlySet<string>, since?: number): Msg[] {
  return msgs.filter((m) => {
    if (m.author.kind === "agent" && m.author.session === own) return false;
    // A person's: sent (it has its input), unless given to it; read from its record (typed at its
    // terminal: no input), the record's.
    if (m.author.kind === "person" && (!m.input || inputs.has(m.input))) return false;
    if (since !== undefined && (m.time ?? 0) < since) return false;
    return true;
  });
}

/** Where each message goes among rows by their times (undefined: as the row before; Infinity: at
 *  the end, what is being written): before the first row later than it, in the log's order. By
 *  the row it goes before (rows.length: after them all). */
export function slotsOf<M extends { time?: number }>(times: (number | undefined)[], ms: M[]): Map<number, M[]> {
  const eff: number[] = [];
  let last = -Infinity;
  for (const t of times) eff.push(t === undefined ? last : (last = t === Infinity ? Infinity : Math.max(last, t)));
  const out = new Map<number, M[]>();
  for (const m of ms) {
    const at = m.time ?? Infinity;
    let i = eff.findIndex((t) => t > at);
    if (i < 0) i = times.length;
    out.set(i, [...(out.get(i) ?? []), m]);
  }
  return out;
}

/** A row the log knows by its number: anchors for the read marks, in the page's order. */
export type Anchor = { key: string; seq: number };

/** Where each reader's mark goes: under the last row it has read (by key), none for one that has
 *  read none of those shown. skip: the member looking. */
export function marksAt<R extends { member: string; seq: number }>(anchors: Anchor[], readers: R[], skip?: string): Map<string, R[]> {
  const out = new Map<string, R[]>();
  for (const r of readers) {
    if (r.member === skip || r.seq < 1) continue;
    let at: Anchor | undefined;
    for (const a of anchors) if (a.seq <= r.seq && (!at || a.seq >= at.seq)) at = a;
    if (at) out.set(at.key, [...(out.get(at.key) ?? []), r]);
  }
  return out;
}

/** The own agent's rows the log knows by number: a said message by the block it was read from
 *  (src.block), else by the last row before where its stretch ends (src.to, a line); a person's
 *  by the input it was (the user block's id). */
export function ownAnchors(msgs: Msg[], own: string, rows: { key: string; line: number; id?: string }[]): Anchor[] {
  const out: Anchor[] = [];
  for (const m of msgs) {
    let key: string | undefined;
    if (m.author.kind === "agent" && m.author.session === own && m.src) {
      if (m.src.block) key = rows.find((r) => r.key === m.src!.block)?.key;
      else if (m.src.to !== undefined) key = rows.filter((r) => r.line < m.src!.to!).at(-1)?.key;
    } else if (m.author.kind === "person" && m.input) key = rows.find((r) => r.id === m.input)?.key;
    if (key) out.push({ key, seq: m.n });
  }
  return out;
}

/** The hand-over (kumo, 2026-11-15): an agent called by a message is shown at work only once that
 *  message is on the page, and, if the own agent said it, its words are whole (written to their
 *  end, not still coming): the words first, then the one called. Held at most HOLD from when it
 *  began to work, so a message that never shows hides no work. */
export const HOLD = 1500;
export type Hold = { since: number; called?: number };
export function held(h: Hold, shown: (seq: number) => boolean, writing: boolean, now: number): boolean {
  if (now - h.since >= HOLD) return false;
  if (writing) return true;
  return h.called !== undefined && !shown(h.called);
}

/** The message that called agent nick: the latest at or after from naming @nick, by another. */
export function callerOf(msgs: Msg[], nick: string, session: string): number | undefined {
  if (!nick) return undefined;
  const at = new RegExp(`(^|[^\\p{L}\\p{N}_-])@${nick.replace(/[-]/g, "\\-")}(?![\\p{L}\\p{N}_-])`, "u");
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.author.kind === "agent" && m.author.session === session) continue;
    if (m.author.kind === "iridium") continue;
    if (at.test(m.text)) return m.n;
  }
  return undefined;
}

/** A subagent at work, under the step that started it (kumo, 2026-11-15: subagents are members
 *  that only read): the Agent (Task) call whose description is its title, by the row that holds
 *  the call; those whose call is not among the rows (still running, on a page not loaded) go at
 *  the end (rest). */
export function subsAt<S extends { id: string; title?: string }>(rows: { key: string; steps: { name?: string; input?: string }[] }[], subs: S[]): { at: Map<string, S[]>; rest: S[] } {
  const at = new Map<string, S[]>();
  const rest: S[] = [];
  const told = (input?: string) => {
    try {
      const v = JSON.parse(input ?? "") as { description?: unknown };
      return typeof v.description === "string" ? v.description : undefined;
    } catch {
      return undefined;
    }
  };
  for (const s of subs) {
    const row = s.title ? rows.findLast((r) => r.steps.some((x) => (x.name === "Agent" || x.name === "Task") && told(x.input) === s.title)) : undefined;
    if (row) at.set(row.key, [...(at.get(row.key) ?? []), s]);
    else rest.push(s);
  }
  return { at, rest };
}
