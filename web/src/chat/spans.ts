// Step spans read from an agent's own record (work.tsx), kept in memory and persisted by
// device/chats.ts alongside each channel's copy so a page reload draws tool icons and step lists
// straight from cache without waiting for the network. Kept apart from work.tsx so device/chats.ts
// never pulls UI or Markdown into its chunk.
import { api } from "../api/client";
import type { Block } from "../api/types.gen";
import { lineOf } from "../chats";
import { folded, type Step } from "./fold";

/** Lines from..to of a session's record as read so far: the blocks, where to read on from, and
 *  whether it has all of it. */
export type Span = { blocks: Block[]; next: number; to?: number; whole: boolean; coming?: Promise<void>; again: boolean };

/** Serialized span kept in this device's cache (device/chats.ts). */
export type KeptSpan = { session: string; from: number; to?: number; next: number; whole: boolean; blocks: Block[] };

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
 *  each time it is asked again). Each line once; one at a time. */
export function readSteps(session: string, from: number, to?: number, want?: number): Promise<void> {
  const k = spanKey(session, from);
  let sp = spans.get(k);
  if (!sp) spans.set(k, (sp = { blocks: [], next: from, whole: false, again: false }));
  const it = sp;
  // want: as many calls as the work says it has, from its first line on: where the work ends is
  // not asked of the record's length (it may not have been all written when that was read).
  if (want !== undefined) {
    if (stepsOf(it.blocks, false).length >= want) return Promise.resolve();
    to = undefined;
  }
  if (to !== undefined && it.to === undefined) {
    it.to = to;
    it.blocks = it.blocks.filter((b) => lineOf(b) < to);
    if (it.next >= to) it.whole = true;
  }
  if (it.whole) return Promise.resolve();
  if (it.coming) {
    it.again = true;
    return it.coming;
  }
  let added = false;
  it.coming = (async () => {
    do {
      it.again = false;
      for (;;) {
        const at = it.next;
        const p = await api.messages(session, { after: at }, { priority: "low" } as RequestInit);
        const got = p.blocks.filter((b) => lineOf(b) >= at && (it.to === undefined || lineOf(b) < it.to));
        if (got.length) {
          it.blocks = [...it.blocks, ...got];
          added = true;
        }
        it.next = Math.max(at, p.end);
        if (it.to !== undefined && it.next >= it.to) it.whole = true;
        told();
        if (it.whole || p.end <= at || (want !== undefined && stepsOf(it.blocks, false).length >= want)) break;
      }
    } while (it.again && !it.whole);
  })().finally(() => {
    it.coming = undefined;
    if (added) notifySaved();
  });
  return it.coming;
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

/** Collects the loaded spans referenced by a channel's messages, for device/chats.ts to persist. */
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
    out.push({ session, from, ...(sp.to !== undefined ? { to: sp.to } : {}), next: sp.next, whole: sp.whole, blocks: sp.blocks });
  }
  return out;
}

/** Restores cached spans from device/chats.ts into memory without overwriting fresher spans. */
export function restoreSpans(kept: readonly KeptSpan[] | undefined): boolean {
  if (!kept?.length) return false;
  let changed = false;
  for (const c of kept) {
    if (!c.session || typeof c.from !== "number" || !Array.isArray(c.blocks) || !c.blocks.length) continue;
    const k = spanKey(c.session, c.from);
    const cur = spans.get(k);
    if (cur && (cur.blocks.length >= c.blocks.length || cur.whole)) continue;
    spans.set(k, { blocks: c.blocks, next: c.next, ...(c.to !== undefined ? { to: c.to } : {}), whole: c.whole, again: false });
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
