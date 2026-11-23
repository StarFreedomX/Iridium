// A channel's subscriptions (docs/channels.md "订阅事件"): what wakes an agent beside @, what runs
// a command (a script of its IR), what the page reads and writes of them, pure for tests: an
// agent's in short words, a trigger in words, a cron line read, why the server refused one.
import type { Trigger } from "../../api/types.gen";

const SCRIPT = "script:";

/** The script a message's author is: its user "script:<name>", or its _data.script. */
export const scriptOfUser = (id?: string, data?: string): string | undefined => data || (id?.startsWith(SCRIPT) ? id.slice(SCRIPT.length) : undefined) || undefined;

/** A sender list as an older line of the channel may still say it (a receive set; before
 *  2026-11-17: "all", "at"). */
export function recvOf(r: unknown): string[] {
  if (Array.isArray(r)) return r.filter((x): x is string => typeof x === "string");
  return r === "all" ? ["*"] : [];
}

/** An agent's subscriptions as the server may say them: none, none (only @). */
export const onOf = (on: unknown): Trigger[] => (Array.isArray(on) ? on.filter((x): x is Trigger => !!x && typeof x === "object") : []);

/** A plain message subscription: of senders, of no words in particular. */
const plain = (tr: Trigger) => !!tr.message && !tr.message.words?.length && !tr.text;

/** The senders whose words wake an agent, as its plain message subscription names them (the
 *  members menu's quick list); none: there is none. */
export const fromOf = (on: Trigger[]): string[] => on.find(plain)?.message?.from ?? [];

/** on with its plain message subscription's senders now from: put in where there was none, taken
 *  out where from is empty. */
export function withFrom(on: Trigger[], from: string[]): Trigger[] {
  const i = on.findIndex(plain);
  const tr: Trigger = { message: { from } };
  if (i < 0) return from.length ? [...on, tr] : on;
  return from.length ? on.map((x, j) => (j === i ? tr : x)) : on.filter((_, j) => j !== i);
}

/** A receive set with entry put in, or taken out. */
export const toggle = (set: string[], entry: string): string[] => (set.includes(entry) ? set.filter((x) => x !== entry) : [...set, entry]);

/** The words a receive set is said in: at, only what names it ([]); all, "*"; sep between names;
 *  n, how many ("{n} 项") when the names do not fit. */
export type RecvWords = { at: string; all: string; sep: string; n: string };

/** A receive set's entries by name ("*" all, the rest as nameOf names them). */
export const recvNames = (recv: string[], nameOf: (entry: string) => string, w: Pick<RecvWords, "all">) => recv.map((e) => (e === "*" ? w.all : nameOf(e)));

/** A sender list in a few words: none, at; else its names, or how many when more than two or
 *  longer than max characters. */
export function recvLabel(recv: string[], nameOf: (entry: string) => string, w: RecvWords, max = 12): string {
  if (!recv.length) return w.at;
  const names = recvNames(recv, nameOf, w);
  const joined = names.join(w.sep);
  return names.length <= 2 && [...joined].length <= max ? joined : w.n.replace("{n}", String(names.length));
}

/** An agent's subscriptions in a few words, beside 订阅事件: none, at (@ only); its plain senders
 *  alone, their names; else how many. */
export function onLabel(on: Trigger[], nameOf: (entry: string) => string, w: RecvWords, max = 12): string {
  if (on.length === 1 && plain(on[0]!)) return recvLabel(fromOf(on), nameOf, w, max);
  return on.length ? w.n.replace("{n}", String(on.length)) : w.at;
}

/** A sender list whole (an older event's line): none, at; else every name. */
export const recvWhole = (recv: string[], nameOf: (entry: string) => string, w: Pick<RecvWords, "at" | "all" | "sep">) => (recv.length ? recvNames(recv, nameOf, w).join(w.sep) : w.at);

/** The words a cron line is read in, {t} a time (09:00), {d} days, {n} a number, {m} a minute;
 *  days: Sunday first, seven. */
export type CronWords = { minute: string; everyMin: string; hourly: string; everyHour: string; daily: string; weekdays: string; weekly: string; monthly: string; days: string[]; sep: string };

const num = (s: string, lo: number, hi: number) => /^\d{1,2}$/.test(s) && +s >= lo && +s <= hi;
const pad = (n: number) => String(n).padStart(2, "0");

/** A cron line ("m h dom mon dow") read, when it is a simple one: every minute, every n minutes,
 *  each hour, every n hours, each day, weekdays, some days of the week, a day of the month; else
 *  none (shown as written). */
export function cronReading(cron: string, w: CronWords): string | undefined {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return undefined;
  const [m, h, dom, mon, dow] = f as [string, string, string, string, string];
  if (mon !== "*") return undefined;
  const fill = (tpl: string, v: Record<string, string>) => Object.entries(v).reduce((s, [k, x]) => s.replace(`{${k}}`, x), tpl);
  const every = (s: string, hi: number) => (/^\*\/\d{1,2}$/.test(s) && +s.slice(2) >= 1 && +s.slice(2) <= hi ? s.slice(2) : undefined);
  const restAll = dom === "*" && dow === "*";
  if (m === "*" && h === "*" && restAll) return w.minute;
  const em = every(m, 59);
  if (em && h === "*" && restAll) return fill(w.everyMin, { n: String(+em) });
  if (!num(m, 0, 59)) return undefined;
  if (h === "*" && restAll) return fill(w.hourly, { m: String(+m) });
  const eh = every(h, 23);
  if (eh && +m === 0 && restAll) return fill(w.everyHour, { n: String(+eh) });
  if (!num(h, 0, 23)) return undefined;
  const at = `${pad(+h)}:${pad(+m)}`;
  if (restAll) return fill(w.daily, { t: at });
  if (dom === "*" && dow === "1-5") return fill(w.weekdays, { t: at });
  if (dom === "*" && /^[0-7](,[0-7])*$/.test(dow)) return fill(w.weekly, { d: [...new Set(dow.split(",").map((d) => +d % 7))].map((d) => w.days[d]).join(w.sep), t: at });
  if (dow === "*" && num(dom, 1, 31)) return fill(w.monthly, { n: String(+dom), t: at });
  return undefined;
}

/** The words a trigger is said in: message ({from}), messageHas ({from} {words}), each word in
 *  quote ({w}) and or between them; anyone, a message with no from; command ({name}), cron
 *  ({when}), event ({events}); events by type; sep between names. */
export type TriggerWords = { message: string; messageHas: string; quote: string; or: string; anyone: string; command: string; cron: string; event: string; events: Record<string, string>; sep: string; textSep: string; recv: Pick<RecvWords, "all">; when: CronWords };

/** A trigger in one line: 消息：全体成员 含“大肥鱼”, 指令：/echo, 定时：每天 09:00, 事件：加入、移出. */
export function triggerLine(tr: Trigger, nameOf: (entry: string) => string, w: TriggerWords): string {
  return [triggerHead(tr, nameOf, w), tr.text?.trim()].filter(Boolean).join(w.textSep);
}

function triggerHead(tr: Trigger, nameOf: (entry: string) => string, w: TriggerWords): string {
  if (tr.message) {
    const from = tr.message.from?.length ? recvNames(tr.message.from, nameOf, w.recv).join(w.sep) : w.anyone;
    const words = (tr.message.words ?? []).filter(Boolean);
    if (!words.length) return w.message.replace("{from}", from);
    return w.messageHas.replace("{from}", from).replace("{words}", words.map((x) => w.quote.replace("{w}", x)).join(w.or));
  }
  if (tr.command) return w.command.replace("{name}", tr.command);
  if (tr.cron) return w.cron.replace("{when}", cronReading(tr.cron, w.when) ?? tr.cron);
  if (tr.event) return w.event.replace("{events}", [...new Set(tr.event.map(eventKind))].map((e) => w.events[e] ?? e).join(w.sep));
  return "";
}

/** The events a subscription may wait for (internal/api Events). */
export const EVENTS = ["join", "leave", "rename", "on", "error", "ask"] as const;

/** An event as the subscriptions name it: those from before them as theirs now. */
export const eventKind = (e: string) => (e === "recv" || e === "script" ? "on" : e === "people" ? "join" : e);

/** Words typed as a list: split at commas (either width), 、 and spaces. */
export const splitWords = (s: string) => s.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);

/** A name as a script's is written (a nick's rule: letters, digits, _ and -, at most 32): what
 *  else is in it dropped. */
export const asName = (s: string) => [...s.replace(/[^\p{L}\p{N}_-]/gu, "")].slice(0, 32).join("");

/** Why the server refused a script, as a key of the page's words (by its status and the field
 *  its message begins with); none: its own message. */
export function scriptRefusal(status: number, message: string): string | undefined {
  if (status === 409) return "taken";
  if (status === 403) return "forbidden";
  if (/another computer/.test(message)) return "away";
  const on = /^on(?:\[\d+\])?(?:\.([a-z]+(?:\.[a-z]+)?))?\b/.exec(message);
  const field = on ? (on[1] ? `on.${on[1]}` : "on") : /^([a-z.]+):/.exec(message)?.[1];
  const known: Record<string, string> = { name: "name", run: "run", intro: "intro", avatar: "avatar", on: "on", "on.message.from": "from", "on.message": "from", "on.command": "command", "on.cron": "cron", "on.event": "event", "on.text": "text", "on.each": "on" };
  return field ? known[field] : undefined;
}

/** A trigger as the editor holds it: its kind and each kind's fields, kept as the kind is
 *  changed back and forth; words as typed. */
export type TriggerKind = "message" | "command" | "cron" | "event";
export type TriggerDraft = { kind: TriggerKind; from: string[]; words: string; command: string; cron: string; event: string[]; text: string };

export const blankTrigger = (kind: TriggerKind = "message"): TriggerDraft => ({ kind, from: [], words: "", command: "", cron: "0 9 * * *", event: [], text: "" });

export function draftOf(tr: Trigger): TriggerDraft {
  const d = blankTrigger(tr.command ? "command" : tr.cron ? "cron" : tr.event ? "event" : "message");
  return { ...d, from: tr.message?.from ?? [], words: (tr.message?.words ?? []).join(" "), command: tr.command ?? "", cron: tr.cron ?? d.cron, event: [...new Set((tr.event ?? []).map(eventKind))], text: tr.text ?? "" };
}

/** A trigger as the server takes it, of the draft's kind alone; its words, if any. */
export function triggerOf(d: TriggerDraft): Trigger {
  const text = d.text.trim() ? { text: d.text.trim() } : {};
  switch (d.kind) {
    case "message": {
      const words = splitWords(d.words);
      return { message: { ...(d.from.length ? { from: d.from } : {}), ...(words.length ? { words } : {}) }, ...text };
    }
    case "command":
      return { command: d.command.trim().replace(/^\//, ""), ...text };
    case "cron":
      return { cron: d.cron.trim().replace(/\s+/g, " "), ...text };
    case "event":
      return { event: d.event, ...text };
  }
}
