// What an agent did after a message of its own, as one line under its words (docs/next/ui.md §3
// "在干活"; a message of kind "work", no words, is this line alone). One line high whatever it says:
// where the agent works when that is not the channel's folder, then while it runs its step and the
// call, the stop key at the right; done, how many steps and how long. What older messages say they
// did before them (<iridium:activity>) is the same line. Pressed, the steps open under it in place,
// one a row, read from the agent's own record over the lines the work spans; a step pressed, its
// card (input, output, diff) from that row. Which lines are open is kept in this browser.
import { Popover } from "@base-ui/react/popover";
import { ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { api } from "../api/client";
import type { Block } from "../api/types.gen";
import { lineOf } from "../chats";
import { t, useLang } from "../i18n";
import { cn, keep, kept, PopSurface, useEver } from "../ui";
import { useAway, Where } from "./away";
import type { Did, Work } from "./channel/lib";
import { isShell } from "./cmd";
import { folded, kindOf, type Step } from "./fold";
import { StopKey } from "./live";
import { Pictures } from "./pictures";
import { KindIcon, lasted, ROW, StepCard, StepLine, tookOf } from "./said";
import { byHand } from "./stick";

/** How many step rows show at most; past that the list scrolls in itself. */
export const ROWS = 8;

// --- the steps, read from the agent's record ---

/** Lines from..to of a session's record as read so far: the blocks, where to read on from, and
 *  whether it has all of it. */
type Span = { blocks: Block[]; next: number; to?: number; whole: boolean; coming?: Promise<void>; again: boolean };
const spans = new Map<string, Span>();
const spanSubs = new Set<() => void>();
const told = () => {
  for (const f of spanSubs) f();
};
const spanSub = (f: () => void) => (spanSubs.add(f), () => void spanSubs.delete(f));
const spanKey = (session: string, from: number) => `${session} ${from}`;

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
  it.coming = (async () => {
    do {
      it.again = false;
      for (;;) {
        const at = it.next;
        const p = await api.messages(session, { after: at }, { priority: "low" } as RequestInit);
        const got = p.blocks.filter((b) => lineOf(b) >= at && (it.to === undefined || lineOf(b) < it.to));
        if (got.length) it.blocks = [...it.blocks, ...got];
        it.next = Math.max(at, p.end);
        if (it.to !== undefined && it.next >= it.to) it.whole = true;
        told();
        if (it.whole || p.end <= at || (want !== undefined && stepsOf(it.blocks, false).length >= want)) break;
      }
    } while (it.again && !it.whole);
  })().finally(() => (it.coming = undefined));
  return it.coming;
}

/** The calls of a span read so far, in order; running: its last calls may still be. */
export function stepsOf(blocks: Block[], running: boolean): Step[] {
  return folded(blocks, running).flatMap((b) => (b.kind === "fold" ? b.steps.filter((s) => s.kind === "tool") : b.kind === "running" ? [b.tool as Step] : []));
}

const useSpan = (session: string, from: number | undefined): Block[] | undefined => useSyncExternalStore(spanSub, () => (from === undefined ? undefined : spans.get(spanKey(session, from))?.blocks));

// --- which lines are open, kept in this browser ---

const OPEN_KEY = "work-open";
const OPEN_KEEP = 300;
let opens: string[] | undefined;
const openSubs = new Set<() => void>();
const openList = () => {
  if (!opens) {
    try {
      const v = JSON.parse(kept(OPEN_KEY) ?? "[]");
      opens = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      opens = [];
    }
  }
  return opens;
};
/** Whether the line of message n of channel is open. */
export const isOpen = (channel: string, n: number) => openList().includes(`${channel} ${n}`);
function setOpen(channel: string, n: number, open: boolean) {
  const k = `${channel} ${n}`;
  const rest = openList().filter((x) => x !== k);
  opens = open ? [...rest, k].slice(-OPEN_KEEP) : rest;
  keep(OPEN_KEY, JSON.stringify(opens));
  for (const f of openSubs) f();
}
const openSub = (f: () => void) => (openSubs.add(f), () => void openSubs.delete(f));
const useOpen = (channel: string, n: number) => useSyncExternalStore(openSub, () => isOpen(channel, n));

// --- the line ---

/** How long, in words: 12 秒, 3 分 5 秒. */
const tookWords = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return t("work.sec", { s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("work.min", { m, s: s % 60 });
  return t("work.hour", { h: Math.floor(m / 60), m: m % 60 });
};

/** What older messages say was done before them, in the line's words. */
function didParts(did: Did): string[] {
  const parts: string[] = [];
  if (did.bash) parts.push(`bash ${did.bash}${did.cmds ? `（${did.cmds}）` : ""}${did.failed ? t("channel.did.failed", { n: did.failed }) : ""}`);
  if (did.files) parts.push(`${t("channel.did.files", { n: did.files })} +${did.add} −${did.del}`);
  if (did.read) parts.push(t("channel.did.read", { n: did.read }));
  if (did.web) parts.push(t("channel.did.web", { n: did.web }));
  if (did.agents) parts.push(t("channel.did.agents", { n: did.agents }));
  if (did.other) parts.push(t("channel.did.other", { n: did.other }));
  return parts;
}

/** A step pressed: its card, out of its row (kept as it shuts, to fold back into it). */
type Card = { at: string; el: HTMLElement; open: boolean };

/** An agent's work on a message of channel (n, its number): work, as the message carries it; or
 *  did, what an older message says was done before it, and span: where that is in the record, if
 *  it says. session: the agent's, whose record it is. may: the one looking may stop it. esc: Esc
 *  in the composer stops it too (the channel's one agent). */
export function WorkLine({ channel, n, session, work, did, span, may, esc }: { channel: string; n: number; session: string; work?: Work; did?: Did; span?: { from: number; to: number }; may: boolean; esc?: boolean }) {
  useLang();
  const away = useAway(channel, session);
  const from = work ? work.from : span?.from;
  const to = work ? work.to : span?.to;
  const running = !!work?.running;
  const steps = work?.steps ?? 0;
  const opens = from !== undefined && (running || steps > 0 || !!span);
  const open = useOpen(channel, n) && opens;
  const blocks = useSpan(session, from);
  const [card, setCard] = useState<Card | null>(null);
  const reveal = useRef<HTMLDivElement>(null);
  // How many rows high its steps are, set as they open: ROWS while the work goes on, else as many
  // as it has (said by the work, or read already).
  const rowsNow = () => (running ? ROWS : Math.max(1, Math.min(ROWS, steps || (blocks ? stepsOf(blocks, false).length : ROWS))));
  const [rows, setRows] = useState(rowsNow);
  const read = () => from !== undefined && void (work ? readSteps(session, from, undefined, steps) : readSteps(session, from, to)).catch(() => {});
  // Read as it is open, and again as its steps go on.
  useEffect(() => void (open && read()), [open, steps, running, to]);
  const parts = did && !work ? didParts(did) : [];
  if (!work && !parts.length) return null;
  const toggle = () => {
    if (!opens) return;
    // A person's doing: the conversation follows its height quickly (stick.tsx).
    if (reveal.current) byHand(reveal.current);
    if (open) setCard((c) => c && { ...c, open: false });
    else {
      read();
      setRows(rowsNow());
    }
    setOpen(channel, n, !open);
  };
  return (
    <div className="min-w-0">
      <div className="flex h-7 min-w-0 items-center gap-1 pointer-coarse:h-9">
        <button
          type="button"
          aria-expanded={opens ? open : undefined}
          disabled={!opens}
          onPointerEnter={read}
          onPointerDown={read}
          onFocus={read}
          onClick={toggle}
          className={cn("flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left text-sm text-ink-3 outline-none", opens && "cursor-pointer hover:text-ink-2 focus-visible:text-ink-2", open && "text-ink-2")}
        >
          {away && <Where place={away} short />}
          {work ? (
            running ? (
              <>
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-run" />
                <span key={`s${steps}`} className="g-fade shrink-0 tabular-nums">
                  {t("work.step", { n: steps })}
                </span>
                {work.tool && (
                  <span key={`t${steps}`} className="g-fade flex min-w-0 items-center gap-1.5">
                    <KindIcon kind={kindOf(work.tool)} shell={isShell(work.tool)} />
                    <span className="min-w-0 truncate text-ink-2">{work.tool}</span>
                  </span>
                )}
                {!!work.agents && (
                  <span key={`a${work.agents}`} className="g-fade shrink-0 tabular-nums">
                    {t("work.agents", { n: work.agents })}
                  </span>
                )}
              </>
            ) : (
              <span key="done" className="g-fade flex min-w-0 items-center gap-2 tabular-nums">
                <span className="shrink-0">{steps === 1 ? t("work.step1") : t("work.steps", { n: steps })}</span>
                {!!work.agents && <span className="shrink-0">{t("work.agents", { n: work.agents })}</span>}
                {!!work.ms && <span className="min-w-0 truncate">{tookWords(work.ms)}</span>}
              </span>
            )
          ) : (
            <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap tabular-nums">
              {parts.map((p, i) => (
                <span key={i} className={cn(i === parts.length - 1 ? "min-w-0 truncate" : "shrink-0")}>
                  {p}
                </span>
              ))}
            </span>
          )}
          {opens && <ChevronRight size={13} aria-hidden className={cn("shrink-0 text-ink-4 transition-transform duration-(--dur-2)", open && "rotate-90")} />}
        </button>
        {running && may && <StopKey session={session} esc={esc} />}
      </div>
      {opens && <StepList reveal={reveal} session={session} blocks={blocks} running={running} rows={rows} open={open} card={card} setCard={setCard} limit={work ? Math.max(steps, 1) : undefined} />}
    </div>
  );
}

/** The steps under a line, opened in place: a row each, at most ROWS seen, the rest scrolled to in
 *  the list itself. Its height (rows) is set as it opens and kept while it is: ROWS while the work
 *  goes on (new steps come in the list, which keeps its newest in view, and does not grow), as
 *  many as there are once it is done. A row pressed: its card, out of the row. */
function StepList({ reveal, session, blocks, running, rows, open, card, setCard, limit }: { reveal: RefObject<HTMLDivElement | null>; session: string; blocks?: Block[]; running: boolean; rows: number; open: boolean; limit?: number; card: Card | null; setCard: (c: Card | null) => void }) {
  const list = useMemo(() => (blocks ? stepsOf(blocks, running).slice(0, limit) : []), [blocks, running, limit]);
  // Made as it is first opened.
  const ever = useEver(open);
  const box = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const wasOn = useRef("");
  // A press anywhere but on the card puts it away (a row's own press: above).
  useEffect(() => {
    if (!card?.open) return;
    const down = (e: PointerEvent) => !(e.target as Element).closest?.("[role=dialog]") && setCard({ ...card, open: false });
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [card]);
  // Opened already as it is first drawn (kept open): there at once, not opening under the eyes.
  const [snap, setSnap] = useState(open);
  useEffect(() => {
    if (!snap) return;
    const f = requestAnimationFrame(() => setSnap(false));
    return () => cancelAnimationFrame(f);
  }, [snap]);
  // Its newest in view, in the list itself, unless the one looking went up in it.
  useLayoutEffect(() => {
    const el = box.current;
    if (open && el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [open, list.length]);
  const shown = card ? list.find((s) => s.at === card.at) : undefined;
  const rowsOf = list.map((s) => {
    const took = tookOf(s);
    const on = !!card?.open && card.at === s.at;
    return (
      <button
        key={s.at}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={on}
        onPointerDown={() => (wasOn.current = on ? s.at : "")}
        onClick={(e) => {
          // Pressed while its card was open: the card is put away (the press outside it did that
          // already), not opened again.
          const shut = on || wasOn.current === s.at;
          wasOn.current = "";
          setCard(shut ? (card ? { ...card, open: false } : null) : { at: s.at, el: e.currentTarget, open: true });
        }}
        className={cn(ROW, "w-full shrink-0 text-left outline-none focus-visible:text-ink-2", on && "text-ink")}
      >
        <StepLine s={s} />
        {took !== undefined && <span className="ml-auto shrink-0 pl-2 text-xs text-ink-4 tabular-nums">{lasted(took)}</span>}
      </button>
    );
  });
  return (
    <>
      <div ref={reveal} inert={!open || undefined} aria-hidden={!open || undefined} className={cn("g-reveal", snap && "g-snap")} data-open={open ? "" : undefined}>
        <div className="min-h-0 min-w-0 overflow-hidden">
          {ever && (
            <div
              ref={box}
              onScroll={(e) => (atEnd.current = e.currentTarget.scrollHeight - e.currentTarget.clientHeight - e.currentTarget.scrollTop < 8)}
              style={{ "--rows": rows } as CSSProperties}
              className="steps-scroll ml-[3px] flex h-[calc(var(--rows)*28px)] min-w-0 flex-col overflow-y-auto overscroll-contain pl-3 shadow-[inset_1px_0_0_var(--edge)] pointer-coarse:h-[calc(var(--rows)*36px)]"
            >
              {rowsOf}
            </div>
          )}
        </div>
      </div>
      {ever && (
        <Popover.Root open={!!card?.open && !!shown} onOpenChange={(o) => !o && card && setCard({ ...card, open: false })}>
          <PopSurface anchor={card?.el} still sideOffset={4} className="flex max-h-[min(72dvh,620px,var(--available-height))] w-[min(620px,calc(100vw-16px))] flex-col overflow-hidden">
            {shown && (
              <>
                <StepCard key={shown.at} s={shown} session={session} />
                {shown.kind === "tool" && !!shown.result?.images?.length && (
                  <div className="px-3 pb-3">
                    <Pictures session={session} s={shown} />
                  </div>
                )}
              </>
            )}
          </PopSurface>
        </Popover.Root>
      )}
    </>
  );
}
