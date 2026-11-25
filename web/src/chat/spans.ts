// Step spans read from an agent's own record (work.tsx), kept in memory and persisted by
// device/chats.ts alongside each channel's copy so a page reload draws tool icons and step lists
// straight from cache without waiting for the network. Kept apart from work.tsx so device/chats.ts
// never pulls UI or Markdown into its chunk.
import { api } from "../api/client";
import type { Block } from "../api/types.gen";
import { diffOf, folded, inputOf, type Step } from "./fold";

const lineOf = (b: { at: string }) => parseInt(b.at);

/** Lines from..to of a session's record as read so far: the blocks, where to read on from,
 *  whether it has all of it, and whether the blocks are brief summaries (collapsed rendering only;
 *  full details are fetched on demand when opened/hovered). */
export type Span = { blocks: Block[]; next: number; to?: number; whole: boolean; brief?: boolean; coming?: Promise<void>; again: boolean };

/** Serialized minimal span kept in this device's cache (device/chats.ts). */
export type KeptSpan = { session: string; from: number; to?: number; next: number; whole: boolean; brief?: boolean; blocks: Block[] };

const spans = new Map<string, Span>();
const spanSubs = new Set<() => void>();
const savedSubs = new Set<() => void>();
let spanVer = 0;

const told = () => {
  spanVer++;
  for (const f of spanSubs) f();
};
const notifySaved = () => {
  for (const f of savedSubs) f();
};

export const spanSub = (f: () => void) => (spanSubs.add(f), () => void spanSubs.delete(f));
export const onSpans = (f: () => void) => (savedSubs.add(f), () => void savedSubs.delete(f));
export const spanKey = (session: string, from: number) => `${session} ${from}`;
export const spanBlocks = (session: string, from: number): Block[] | undefined => spans.get(spanKey(session, from))?.blocks;
export const spansVersion = () => spanVer;

/** Reads session's record from line from on, as far as to (none: as far as it goes now; read on
 *  each time it is asked again). Each line once; one at a time. When a span currently holds only
 *  brief summary blocks (from /first or device cache), upgrades it to full blocks seamlessly
 *  without clearing the visible summary while fetching. */
export function readSteps(session: string, from: number, to?: number, want?: number): Promise<void> {
  const k = spanKey(session, from);
  let sp = spans.get(k);
  if (!sp) spans.set(k, (sp = { blocks: [], next: from, whole: false, again: false }));
  const it = sp;
  const upgrading = !!it.brief;
  // want: as many calls as the work says it has, from its first line on: where the work ends is
  // not asked of the record's length (it may not have been all written when that was read).
  if (want !== undefined) {
    if (!upgrading && stepsOf(it.blocks, false).length >= want) return Promise.resolve();
    to = undefined;
  }
  if (to !== undefined && it.to === undefined) {
    it.to = to;
    if (!upgrading) {
      it.blocks = it.blocks.filter((b) => lineOf(b) < to);
      if (it.next >= to) it.whole = true;
    }
  }
  if (!upgrading && it.whole) return Promise.resolve();
  if (it.coming) {
    it.again = true;
    return it.coming;
  }
  let added = false;
  it.coming = (async () => {
    do {
      it.again = false;
      const startFrom = it.brief ? from : it.next;
      let cursor = startFrom;
      let fresh: Block[] | undefined = it.brief ? [] : undefined;
      for (;;) {
        const at = cursor;
        const p = await api.messages(session, { after: at }, { priority: "low" } as RequestInit);
        const got = p.blocks.filter((b) => lineOf(b) >= at && (it.to === undefined || lineOf(b) < it.to));
        if (fresh) {
          fresh.push(...got);
          it.blocks = [...fresh];
          it.brief = false;
          added = true;
        } else if (got.length) {
          it.blocks = [...it.blocks, ...got];
          added = true;
        }
        cursor = Math.max(at, p.end);
        it.next = cursor;
        if (it.to !== undefined && it.next >= it.to) it.whole = true;
        told();
        if (it.whole || p.end <= at || (want !== undefined && stepsOf(it.blocks, false).length >= want)) break;
      }
      if (it.brief) it.brief = false;
    } while (it.again && !it.whole);
  })().finally(() => {
    it.coming = undefined;
    if (added) notifySaved();
  });
  return it.coming;
}

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n));

/** Strips a tool call's JSON input to the minimal fields required to render a collapsed work row. */
function briefInputClient(b: Block): string | undefined {
  if (!b.input) return b.input;
  const i = inputOf(b.input);
  const out: Record<string, unknown> = {};
  const copy = (limit: number, ...keys: string[]) => {
    for (const k of keys) {
      const v = i[k];
      if (typeof v === "string" && v) out[k] = clip(v, limit);
    }
  };
  copy(240, "file_path", "notebook_path", "path");
  copy(400, "command", "cmd");
  copy(200, "pattern", "query", "url");
  copy(160, "description", "prompt", "subject", "plan");
  if (Array.isArray(i.todos)) out.todos = new Array<number>(i.todos.length).fill(0);
  if (Array.isArray(i.changes)) {
    const paths = i.changes.flatMap((c: { path?: unknown }) => (typeof c?.path === "string" && c.path ? [{ path: clip(c.path, 240) }] : []));
    if (paths.length) out.changes = paths;
  }
  const d = diffOf(b);
  if (d) out._diff = d;
  if (!Object.keys(out).length) {
    const first = Object.entries(i).find(([, v]) => typeof v === "string" && v);
    if (first) out[first[0]] = clip(first[1] as string, 160);
  }
  return JSON.stringify(out);
}

/** Minimal rendering copy of blocks for device cache (no full tool outputs, file bodies or thinking prose). */
export function briefBlocks(blocks: readonly Block[]): Block[] {
  const results = new Map(blocks.flatMap((b) => (b.kind === "result" && b.id ? [[b.id, b] as const] : [])));
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind === "thinking") {
      if (b.text?.trim()) out.push({ at: b.at, kind: "thinking", ...(b.time ? { time: b.time } : {}), text: "…" });
      continue;
    }
    if (b.kind !== "tool") continue;
    const r = b.result ?? (b.id ? results.get(b.id) : undefined);
    out.push({
      at: b.at,
      kind: "tool",
      ...(b.id ? { id: b.id } : {}),
      ...(b.name ? { name: b.name } : {}),
      ...(b.time ? { time: b.time } : {}),
      ...(b.input ? { input: briefInputClient(b) } : {}),
      ...(r ? { result: { at: r.at, ...(r.time ? { time: r.time } : {}), text: "", ...(r.error ? { error: true } : {}) } } : {}),
    });
  }
  return out;
}

/** Seeds brief spans delivered by /first into memory without overwriting fuller spans already loaded. */
export function seedSpans(items: readonly { session: string; from?: number; to?: number; brief?: boolean; blocks: Block[] }[] | undefined): boolean {
  if (!items?.length) return false;
  let changed = false;
  for (const item of items) {
    if (!item.session || typeof item.from !== "number" || !item.blocks.length) continue;
    const k = spanKey(item.session, item.from);
    const cur = spans.get(k);
    const isBrief = item.brief ?? false;
    if (cur && (!cur.brief || cur.blocks.length >= item.blocks.length)) continue;
    const last = item.blocks.at(-1);
    const next = Math.max(item.to ?? 0, last ? lineOf(last) + 1 : item.from);
    spans.set(k, {
      blocks: item.blocks,
      next,
      ...(item.to ? { to: item.to } : {}),
      whole: !isBrief && !!item.to,
      brief: isBrief,
      again: false,
    });
    changed = true;
  }
  if (changed) {
    told();
    notifySaved();
  }
  return changed;
}

/** The calls of a span read so far, in order; running: its last calls may still be. */
export function stepsOf(blocks: Block[], running: boolean): Step[] {
  return folded(blocks, running).flatMap((b) => (b.kind === "fold" ? b.steps.filter((s) => s.kind === "tool") : b.kind === "running" ? [b.tool as Step] : []));
}

/** The steps of a span read so far with its thinking, as far as its limit-th call (all, with none). */
export function allStepsOf(blocks: Block[], running: boolean, limit?: number): Step[] {
  const all = folded(blocks, running).flatMap((b) => (b.kind === "fold" ? b.steps : b.kind === "running" ? [b.tool as Step] : []));
  if (limit === undefined) return all;
  let calls = 0;
  const out: Step[] = [];
  for (const s of all) {
    if (s.kind === "tool" && ++calls > limit) break;
    out.push(s);
  }
  return out;
}

type SpanRef = { author: { kind: string; session?: string }; work?: { from: number }; src?: { session: string; from?: number } };

/** Collects minimal brief spans referenced by a channel's messages, for device/chats.ts to persist. */
export function collectSpans(msgs: readonly SpanRef[]): KeptSpan[] {
  const seen = new Set<string>();
  const out: KeptSpan[] = [];
  for (const m of msgs) {
    const session = m.work ? (m.author.kind === "agent" ? m.author.session : m.src?.session) : m.src?.session;
    const from = m.work ? m.work.from : m.src?.from;
    if (!session || from === undefined) continue;
    const k = spanKey(session, from);
    if (seen.has(k)) continue;
    seen.add(k);
    const sp = spans.get(k);
    if (!sp || !sp.blocks.length) continue;
    const blocks = sp.brief ? sp.blocks : briefBlocks(sp.blocks);
    if (!blocks.length) continue;
    out.push({ session, from, ...(sp.to !== undefined ? { to: sp.to } : {}), next: sp.next, whole: false, brief: true, blocks });
  }
  return out;
}

/** Restores cached brief spans from device/chats.ts into memory without overwriting fuller spans. */
export function restoreSpans(kept: readonly KeptSpan[] | undefined): boolean {
  if (!kept?.length) return false;
  let changed = false;
  for (const c of kept) {
    if (!c.session || typeof c.from !== "number" || !Array.isArray(c.blocks) || !c.blocks.length) continue;
    const k = spanKey(c.session, c.from);
    const cur = spans.get(k);
    const isBrief = c.brief ?? false;
    if (cur && (!cur.brief || cur.blocks.length >= c.blocks.length || cur.whole)) continue;
    spans.set(k, { blocks: c.blocks, next: c.next, ...(c.to !== undefined ? { to: c.to } : {}), whole: !isBrief && c.whole, brief: isBrief, again: false });
    changed = true;
  }
  if (changed) told();
  return changed;
}

/** Clears the in-memory span cache (tests). */
export function resetSpans() {
  spans.clear();
  told();
}
