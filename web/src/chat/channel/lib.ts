// A channel of several agents (docs/channels.md), what the page reads of it, pure for tests: its
// messages as the log gives them (Satori's message.list: only what was said), grouped under their
// speakers; the @nick that calls an agent, found in words as the server finds it
// (internal/deliver Mentions) and put into the composer; which sessions are rows of their own; a
// channel's lamp; the agents' quotas, one per kind.
import type { ChannelMessage } from "../../api/client";
import type { Agent, FileRef, Session, Status } from "../../api/types.gen";
import { blockOf } from "../../satori";

/** Who said a message: an agent of the channel (its session, the nick it is called by, what it
 *  ran as), a person (their tag), or Iridium itself. */
export type Author = { kind: "agent"; session: string; nick: string; name: string } | { kind: "person"; id: string; name: string } | { kind: "iridium" };

/** A message of a channel: n, its number there. kind: as its event said it (user, progress, reply,
 *  ask, error, note); the log itself does not say. */
export type Msg = { n: number; text: string; files: FileRef[]; time?: number; author: Author; kind?: string; did?: Did; event?: ChEvent };

/** Something that happened to a channel, a line of Iridium's own in it (internal/channel Event):
 *  join, leave (nick), rename (from, nick), recv (nick, recv), people (added, removed: member
 *  strings; everyone), undelivered (seq, nick), stopped (seq). by: who did it, by name. */
export type ChEvent = { type: string; member?: string; nick?: string; name?: string; from?: string; recv?: string; added?: string[]; removed?: string[]; everyone?: boolean; seq?: number; by?: string };

/** A piece of an event's line: words, an agent by its nick, people by their member strings. */
export type EventPart = string | { nick: string } | { people: string[] };

/** The line's words by event (i18n: channel.event.*), their slots in braces: {nick} {from}
 *  {recv} {people} {seq} {by}. */
export type EventWords = Record<"join" | "leave" | "rename" | "recv" | "everyone" | "added" | "removed" | "undelivered" | "stopped" | "by" | "sep" | "all" | "at", string>;

/** An event as the pieces of its line, in the page's words; none for one not known (its message's
 *  own text is shown then). */
export function eventParts(e: ChEvent, w: EventWords): EventPart[] | undefined {
  const fill = (tpl: string): EventPart[] =>
    tpl
      .split(/(\{[a-z]+\})/)
      .filter(Boolean)
      .map((x): EventPart => {
        switch (x) {
          case "{nick}":
            return { nick: e.nick ?? "" };
          case "{from}":
            return `@${e.from ?? ""}`;
          case "{recv}":
            return e.recv === "all" ? w.all : w.at;
          case "{seq}":
            return String(e.seq ?? "");
          case "{by}":
            return e.by ?? "";
          case "{added}":
            return { people: e.added ?? [] };
          case "{removed}":
            return { people: e.removed ?? [] };
        }
        return x;
      });
  let out: EventPart[];
  switch (e.type) {
    case "join":
    case "leave":
    case "rename":
    case "recv":
    case "undelivered":
    case "stopped":
      out = fill(w[e.type]);
      break;
    case "people": {
      const bits = [e.everyone ? fill(w.everyone) : [], e.added?.length ? fill(w.added) : [], e.removed?.length ? fill(w.removed) : []].filter((b) => b.length);
      if (!bits.length) return undefined;
      out = bits.flatMap((b, i) => (i ? [w.sep, ...b] : b));
      break;
    }
    default:
      return undefined;
  }
  if (e.by) out.push(...fill(w.by));
  // Words side by side are one piece.
  return out.reduce<EventPart[]>((all, p) => (typeof p === "string" && typeof all.at(-1) === "string" ? [...all.slice(0, -1), (all.at(-1) as string) + p] : [...all, p]), []);
}

/** A person's entry by name: an app's all its name, a login its own; not known, as written. */
export function personName(member: string, apps: { id: string; name: string }[], logins: { app: string; id: string; name: string }[]): string {
  const i = member.indexOf("/");
  const app = member.slice(0, i), login = member.slice(i + 1);
  if (i < 0) return member;
  if (login === "*") return apps.find((a) => a.id === app)?.name ?? member;
  return logins.find((l) => l.app === app && l.id === login)?.name ?? member;
}

/** What an agent did before it said a message (docs/channels.md "活动"): its tool calls counted,
 *  the programs its commands began with (cmds, "go 4, git 2"), the files it changed. */
export type Did = { bash: number; failed: number; cmds: string; read: number; web: number; agents: number; other: number; files: number; add: number; del: number; paths: { path: string; add: number; del: number }[] };

const ATTR = /([a-z]+)="([^"]*)"/g;
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The <iridium:activity> of a message's content, if it has one. */
export function didOf(content: string): Did | undefined {
  const at = content.lastIndexOf("<iridium:activity");
  if (at < 0) return undefined;
  const rest = content.slice(at);
  const head = rest.slice(0, rest.indexOf(">") + 1);
  const a: Record<string, string> = {};
  for (const m of head.matchAll(ATTR)) a[m[1]!] = unesc(m[2]!);
  const num = (k: string) => Number(a[k] ?? 0) || 0;
  const paths = [...rest.matchAll(/<iridium:file ([^>]*)\/>/g)].map((f) => {
    const fa: Record<string, string> = {};
    for (const m of f[1]!.matchAll(ATTR)) fa[m[1]!] = unesc(m[2]!);
    return { path: fa.path ?? "", add: Number(fa.add ?? 0) || 0, del: Number(fa.del ?? 0) || 0 };
  });
  return { bash: num("bash"), failed: num("failed"), cmds: a.cmds ?? "", read: num("read"), web: num("search") + num("fetch"), agents: num("agents"), other: num("other"), files: num("files"), add: num("add"), del: num("del"), paths };
}

const AGENT = "agent:";

/** m of the log as the page draws it; none for one without a number. */
export function msgOf(m: ChannelMessage): Msg | undefined {
  const n = Number(m.id);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  const b = blockOf({ id: m.id, content: m.content, created_at: m.created_at });
  const u = m.user;
  const author: Author = u?.id.startsWith(AGENT) ? { kind: "agent", session: u.id.slice(AGENT.length), nick: u.nick ?? "", name: u.name ?? "" } : !u || u.id === "iridium" ? { kind: "iridium" } : { kind: "person", id: u.id, name: u.name ?? "" };
  return { n, text: b.text ?? "", files: b.files ?? [], author, ...(m.created_at ? { time: m.created_at } : {}), ...(m._data?.kind ? { kind: m._data.kind } : {}), ...(author.kind === "agent" && didOf(m.content) ? { did: didOf(m.content)! } : {}), ...(m._data?.event && typeof m._data.event === "object" ? { event: m._data.event as ChEvent } : {}) };
}

/** have with more put in: each number once (the later one wins: a message read again, changed),
 *  in order. The same array when nothing changed. */
export function merge(have: Msg[], more: Msg[]): Msg[] {
  if (!more.length) return have;
  const by = new Map(have.map((m) => [m.n, m]));
  let changed = false;
  for (const m of more) {
    const was = by.get(m.n);
    if (was && was.text === m.text && was.files.length === m.files.length && was.kind === (m.kind ?? was.kind) && !was.did === !m.did && !was.event === !m.event) continue;
    by.set(m.n, was && !m.kind && was.kind ? { ...m, kind: was.kind } : m);
    changed = true;
  }
  return changed ? [...by.values()].sort((a, b) => a.n - b.n) : have;
}

/** Messages one after another under one head: an agent's, while the same agent speaks; Iridium's
 *  lines in a row close together; a person's each by itself. */
export type Group = { key: string; author: Author; msgs: Msg[] };

export function groupMessages(msgs: Msg[]): Group[] {
  const out: Group[] = [];
  for (const m of msgs) {
    const last = out.at(-1);
    if (last && m.author.kind === "agent" && last.author.kind === "agent" && last.author.session === m.author.session) last.msgs.push(m);
    else if (last && m.author.kind === "iridium" && last.author.kind === "iridium") last.msgs.push(m);
    else out.push({ key: `m${m.n}`, author: m.author, msgs: [m] });
  }
  return out;
}

const NICK_RUNE = /[\p{L}\p{N}_-]/u;
const NICK = /^[\p{L}\p{N}_-]+$/u;

/** A nick: letters, digits, "_" and "-", at most 32 of them (internal/deliver ValidNick). */
export const validNick = (n: string) => NICK.test(n) && [...n].length <= 32;

/** Where words call a nick of nicks: "@nick" standing by itself (not inside a word, an address or
 *  a longer name), outside code (a fenced block, an inline span) and quoted lines; case does not
 *  matter. As the server routes by (internal/deliver Mentions), each place it is said. */
export function nickSpans(text: string, nicks: string[]): { from: number; to: number; nick: string }[] {
  if (!nicks.length || !text.includes("@")) return [];
  const by = new Map(nicks.map((n) => [n.toLowerCase(), n]));
  const out: { from: number; to: number; nick: string }[] = [];
  let fenced = false;
  let at = 0;
  for (const line of text.split("\n")) {
    const start = at;
    at += line.length + 1;
    const t = line.trim();
    if (t.startsWith("```") || t.startsWith("~~~")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || t.startsWith(">")) continue;
    let code = false;
    for (const m of line.matchAll(/`|@([\p{L}\p{N}_-]*)/gu)) {
      if (m[0] === "`") {
        code = !code;
        continue;
      }
      if (code) continue;
      const before = [...line.slice(Math.max(0, m.index - 2), m.index)].at(-1);
      if (before !== undefined && (NICK_RUNE.test(before) || before === "@" || before === "/" || before === ".")) continue;
      const nick = by.get(m[1]!.toLowerCase());
      if (nick) out.push({ from: start + m.index, to: start + m.index + m[0].length, nick });
    }
  }
  return out;
}

/** Words cut at the nicks they call: plain runs and nicks, in order. */
export function nickParts(text: string, nicks: string[]): (string | { nick: string })[] {
  const out: (string | { nick: string })[] = [];
  let at = 0;
  for (const s of nickSpans(text, nicks)) {
    if (s.from > at) out.push(text.slice(at, s.from));
    out.push({ nick: s.nick });
    at = s.to;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** The address a nick's link in Markdown has (chat/markdown.tsx draws it: NickLink). */
export const nickURL = (nick: string) => `ir:member/${encodeURIComponent(nick)}`;
export const nickOfURL = (url: unknown) => {
  const m = typeof url === "string" ? /^ir:member\/([^/\s]+)$/.exec(url) : null;
  try {
    return m ? decodeURIComponent(m[1]!) : undefined;
  } catch {
    return undefined;
  }
};

/** An agent's Markdown with each nick it calls a link, drawn as the nick's mark. */
export function linkNicks(text: string, nicks: string[]): string {
  let out = "";
  let at = 0;
  for (const s of nickSpans(text, nicks)) {
    out += `${text.slice(at, s.from)}[@${s.nick}](${nickURL(s.nick)})`;
    at = s.to;
  }
  return out + text.slice(at);
}

/** "@nick " put into text over [a, b) (the caret, a selection, an @word being typed): a space
 *  before it unless at a line's start or after one; the caret after it. */
export function insertNick(text: string, a: number, b: number, nick: string): { text: string; caret: number } {
  const head = text.slice(0, a);
  const before = head + (head && !/\s$/.test(head) ? " " : "");
  const words = `@${nick} `;
  return { text: before + words + text.slice(b).replace(/^ /, ""), caret: before.length + words.length };
}

/** An agent as the @ list and the member bar show it. */
export type AgentRow = { session: string; member: string; agent: Agent; nick: string; name: string; status: Status; recv: string };

/** The agents an @q may call: nicks that start with it first, then nicks and names that have it. */
export function matchAgents<T extends { nick: string; name: string }>(rows: T[], q: string): T[] {
  const w = q.toLowerCase();
  const rank = (r: T) => (!w || r.nick.toLowerCase().startsWith(w) ? 0 : r.nick.toLowerCase().includes(w) ? 1 : r.name.toLowerCase().includes(w) ? 2 : 3);
  return rows
    .map((r) => [rank(r), r] as const)
    .filter(([n]) => n < 3)
    .sort((a, b) => a[0] - b[0])
    .map(([, r]) => r);
}

/** A session that is an agent of another session's channel: shown there, no row of its own. */
export const isMember = (s: Pick<Session, "id" | "channel">) => !!s.channel && s.channel !== s.id;

/** The sessions that are rows of their own: not the agents of another's channel. */
export const withoutMembers = <T extends Pick<Session, "id" | "channel">>(list: T[]): T[] => (list.some(isMember) ? list.filter((s) => !isMember(s)) : list);

/** Whether a session is a channel of several agents. */
export const isMulti = (s?: Pick<Session, "agents">) => (s?.agents?.length ?? 0) > 1;

const WORKING = new Set<Status>(["running", "compacting", "starting"]);

/** A channel's lamp, from its agents': amber while one waits on you, else green while one works,
 *  else its own session's. */
export function channelLamp(own: Status, members: Status[]): Status {
  if (members.includes("waiting")) return "waiting";
  if (WORKING.has(own)) return own;
  return members.some((s) => WORKING.has(s)) ? "running" : own;
}

/** The agents' quotas to show, one per kind and machine (two Claude agents on one login share
 *  one): the first of each, with every model its agents use and whether any has a process. */
export type QuotaKind = { agent: Agent; machine?: string; using: (string | undefined)[]; live: boolean };

export function quotaKinds(agents: { agent: Agent; machine?: string; using?: (string | undefined)[]; live?: boolean }[]): QuotaKind[] {
  const out: QuotaKind[] = [];
  for (const a of agents) {
    let k = out.find((x) => x.agent === a.agent && (x.machine ?? "") === (a.machine ?? ""));
    if (!k) out.push((k = { agent: a.agent, ...(a.machine ? { machine: a.machine } : {}), using: [], live: false }));
    for (const u of a.using ?? []) if (u && !k.using.includes(u)) k.using.push(u);
    k.live ||= !!a.live;
  }
  return out;
}

/** A message sent from here, till the channel's log has it: seq, its number once the server
 *  answered; from, the log's last number as it was sent. */
export type Waiting = { text: string; seq?: number; from: number; failed?: string };

/** Whether what was sent is still not in the log: by its number once known; before that, by a
 *  person's same words said since it was sent. A failed one stays, to be sent again. */
export function stillWaiting(s: Waiting, msgs: Msg[]): boolean {
  if (s.failed !== undefined) return true;
  if (s.seq) return !msgs.some((m) => m.n === s.seq);
  return !msgs.some((m) => m.n > s.from && m.author.kind === "person" && m.text.trim() === s.text.trim());
}

/** The states the stream is asked for besides the channel's own: its other agents' sessions
 *  first, then their contexts, as far as it has room (stream.ts keysFor). */
export const watchExtra = (channel: string, sessions: string[]) => {
  const rest = sessions.filter((s) => s !== channel);
  return [...rest.map((s) => `session:${s}`), ...rest.map((s) => `context:${s}`)];
};

/** A part of what an agent was given (Injection.record): where it is from, the values its slots
 *  took, the messages it cites (#n). */
export type GivenPart = { source: string; values: [string, string][]; refs: string[] };

export function givenParts(record: unknown): GivenPart[] {
  const parts = (record as { parts?: unknown } | null)?.parts;
  if (!Array.isArray(parts)) return [];
  return parts.map((p: { source?: unknown; values?: unknown; refs?: unknown }) => ({
    source: typeof p.source === "string" ? p.source : "",
    values: p.values && typeof p.values === "object" ? Object.entries(p.values as Record<string, unknown>).map(([k, v]) => [k, String(v)] as [string, string]) : [],
    refs: Array.isArray(p.refs) ? p.refs.flatMap((r: { kind?: unknown; id?: unknown }) => (r?.kind === "message" && r.id !== undefined ? [`#${String(r.id)}`] : [])) : [],
  }));
}
