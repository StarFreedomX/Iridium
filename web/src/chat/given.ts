// What an agent was given, verbatim (kumo, 2026-11-26: "原封不动"): its session's injections
// (GET internal/sessions/{id}/injections, the internal interface; Satori's forward in its record
// carries only the messages, satori.ts relays) matched to the blocks of its record by input id,
// and a channel's <channel-context> read into sections for ChannelContext (context.tsx). Every
// character of the text is in exactly one place: the head, a section's row, the tail.
import type { Injection } from "../api/types.gen";

/** A record of what was given: its kind (system, turn-prefix, message, tool-result), the text as
 *  the agent got it, and the heads of the message lines its parts name in order ("#9 [who ·
 *  time", "#5–#8 who: "): where those lines begin, a message's words running over several. */
export type GivenRec = { kind: string; text: string; heads: string[] };

type RawPart = { source?: unknown; values?: Record<string, unknown> };

/** The heads of the lines of a channel's context, from a record's parts (assemble's
 *  channel.context.line and .turn fragments). */
export function headsOf(record: unknown): string[] {
  const parts = (record as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(parts)) return [];
  const out: string[] = [];
  for (const p of parts as RawPart[]) {
    const v = (k: string) => String(p.values?.[k] ?? "");
    if (p.source === "prompts:channel.context.line") out.push(`#${v("seq")} [${v("who")} · ${v("time")}`);
    else if (p.source === "prompts:channel.context.turn") out.push(`#${v("from")}–#${v("to")} ${v("who")}: `);
  }
  return out;
}

const recOf = (record: unknown): GivenRec | undefined => {
  const r = record as { kind?: unknown; text?: unknown } | null;
  return typeof r?.text === "string" && r.text ? { kind: typeof r.kind === "string" ? r.kind : "", text: r.text, heads: headsOf(record) } : undefined;
};

/** What a session was given, by the input each was given as; system: its system prompt (the
 *  latest kept: the one its agent runs with now). verbatim: the session is shown as given.
 *
 *  The rule (kumo, 2026-11-26): verbatim only for an agent that a channel gives its messages
 *  to, a channel member's agent: one with a record of a channel's turn ("turn-prefix": the
 *  "#n: " lines with their <channel-context>, given only where other agents share the channel or
 *  it is in one by a subscription). A person's own chat with one agent stays as it was: its
 *  sender tag ("[网页] ") is not shown in the bubbles of the one who wrote them. */
export function givenOf(list: readonly Injection[] | undefined): { byInput: Map<string, GivenRec>; system?: string; verbatim: boolean } {
  const byInput = new Map<string, GivenRec>();
  let system: string | undefined;
  let verbatim = false;
  // Newest first: the first one for an input is its latest.
  for (const g of list ?? []) {
    const r = recOf(g.record);
    if (!r) continue;
    if (r.kind === "turn-prefix") verbatim = true;
    if (r.kind === "system") system ??= r.text;
    else if (g.input && !byInput.has(g.input)) byInput.set(g.input, r);
  }
  return { byInput, system, verbatim };
}

/** A part of a channel's context: its standing words (about, or the brief "…as before." line),
 *  the new messages (new), what agents did (work), how to read more and react (cmds). */
export type CtxKind = "about" | "new" | "work" | "cmds";
/** A row of a section: a message's line (its head "#9 [who · time]: " and words, a turn's "#5–#8
 *  who: " and first words), else a line as it is. raw: all of it, its line ends too. */
export type CtxRow = { kind: "line"; head: string; words: string; raw: string } | { kind: "text"; raw: string };
export type CtxSection = { kind: CtxKind; rows: CtxRow[]; raw: string };
/** A channel's message as given: what is before its context (the sender's tag, "#n: " and the
 *  words), the context's opening, its sections, its closing, what is after it. */
export type GivenTurn = { head: string; open: string; sections: CtxSection[]; close: string; after: string };

const OPEN = "\n\n<channel-context>\n";
const CLOSE = "</channel-context>";
const NEW_HEADS = [/^Listed by turn \(/, /^In full, what was said since you last read the channel:/, /^#\d+–#\d+: \d+ earlier messages, not shown\./];
const HEADERS: [RegExp, CtxKind][] = [
  ...NEW_HEADS.map((r) => [r, "new"] as [RegExp, CtxKind]),
  [/^Work since you last read the channel/, "work"],
  [/^More of the channel: /, "cmds"],
  [/^React to a message rather than answer it in words: /, "cmds"],
  [/^Taken back since you last read the channel/, "about"],
  [/^Profiles changed since you were last told:/, "about"],
];
const FULL = /^#\d+ \[[^\]\n]*\]: /;
const TURN = /^#\d+–#\d+ [^\n:]+: /;
const TURN_HEAD = /^#\d+–#\d+ /;

/** text read as a channel's message given with its context, by heads (GivenRec.heads; none: by
 *  the lines' looks alone). null: no context in it. Joined back (givenJoined) it is text, to the
 *  character; a line that is none of the known ones stays in the section it comes in, as it is. */
export function parseGiven(text: string, heads: readonly string[] = []): GivenTurn | null {
  const at = text.indexOf(OPEN);
  const end = text.lastIndexOf(CLOSE);
  if (at < 0 || end < at + OPEN.length) return null;
  const body = text.slice(at + OPEN.length, end);
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const sections: CtxSection[] = [];
  let next = 0; // the next head expected
  const section = (kind: CtxKind) => {
    const last = sections.at(-1);
    if (last?.kind === kind) return last;
    const s: CtxSection = { kind, rows: [], raw: "" };
    sections.push(s);
    return s;
  };
  for (const line of lines) {
    const cur = sections.at(-1);
    // A message's line: the next head named, else (no heads) one that looks like one.
    let head: string | undefined;
    if (cur?.kind === "new") {
      if (heads.length) {
        if (next < heads.length && line.startsWith(heads[next]!)) {
          const h = heads[next++]!;
          const e = h.endsWith(": ") ? h.length : line.indexOf("]: ", h.length);
          head = e < 0 ? undefined : line.slice(0, h.endsWith(": ") ? e : e + 3);
        }
      } else head = (FULL.exec(line) ?? TURN.exec(line))?.[0];
    }
    if (head !== undefined) {
      cur!.rows.push({ kind: "line", head, words: line.slice(head.length), raw: line });
      cur!.raw += line;
      continue;
    }
    // A section's first line: not inside a message's words while a named head is still to come
    // (they may hold one that looks like it). A turn's line is one line.
    const last = cur?.rows.at(-1);
    const inWords = cur?.kind === "new" && last?.kind === "line" && !TURN_HEAD.test(last.head) && next < heads.length;
    const kind = inWords ? undefined : HEADERS.find(([r]) => r.test(line))?.[1];
    if (kind) {
      const s = section(kind);
      s.rows.push({ kind: "text", raw: line });
      s.raw += line;
      continue;
    }
    // More of the row before (a message's words over several lines), else a line of the
    // section it is in (the standing words before any).
    const s = cur ?? section("about");
    const row = s.rows.at(-1);
    if (row?.kind === "line" && !TURN_HEAD.test(row.head)) {
      row.words += line;
      row.raw += line;
    } else if (row && s.kind !== "new") {
      row.raw += line;
    } else s.rows.push({ kind: "text", raw: line });
    s.raw += line;
  }
  // A head named that never came (the text not as its parts say): read by the looks instead.
  if (next < heads.length) return parseGiven(text);
  return { head: text.slice(0, at), open: OPEN, sections, close: CLOSE, after: text.slice(end + CLOSE.length) };
}

/** g's text, joined back: the text it was read from. */
export const givenJoined = (g: GivenTurn) => g.head + g.open + g.sections.map((s) => s.rows.map((r) => r.raw).join("")).join("") + g.close + g.after;

/** The block's text without the line end it closes with: drawn as it is, no blank line after. */
export const shownRaw = (s: string) => (s.endsWith("\n") ? s.slice(0, -1) : s);
