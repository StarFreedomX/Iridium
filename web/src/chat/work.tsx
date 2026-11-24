// What an agent did after a message of its own, as one line under its words (docs/next/ui.md §3
// "在干活"; a message of kind "work", no words, is this line alone). One line high whatever it says:
// where the agent works when that is not the channel's folder, then while it runs its step and the
// call, the stop key at the right; done, how many steps and how long. What older messages say they
// did before them (<iridium:activity>) is the same line. Pressed, the steps open under it in place,
// one a row, read from the agent's own record over the lines the work spans; a step pressed, its
// card (input, output, diff) from that row. Which lines are open is kept in this browser.
import { Popover } from "@base-ui/react/popover";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";
import { api } from "../api/client";
import type { Block } from "../api/types.gen";
import { lineOf } from "../chats";
import { t, useLang } from "../i18n";
import { cn, keep, kept, PopSurface, useEver } from "../ui";
import { useAway, Where } from "./away";
import type { Did, Work } from "./channel/lib";
import { cmdOfCall, isShell, type Cmd } from "./cmd";
import { diffSum, foldLine, folded, kindOf, runCmds, type Step } from "./fold";
import { StopKey } from "./live";
import { Pictures } from "./pictures";
import { DiffStat, KindIcon, lasted, ROW, StepCard, StepLine, tookOf } from "./said";
import { byHand } from "./stick";


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

/** What a line's steps are narrowed to: the calls by one name ("": thinking), of one sort of
 *  shell command where its icons are apart, the failed ones apart too. */
export type Only = { name: string; cmd?: Cmd; failed?: boolean; sorted?: boolean };
const sameOnly = (a: Only | null, b: Only | null) => !!a && !!b && a.name === b.name && a.cmd === b.cmd && a.failed === b.failed && a.sorted === b.sorted;
const isOnly = (s: Step, o: Only | null) => !o || (o.name === "" ? s.kind === "thinking" : s.kind === "tool" && s.name === o.name && (!o.sorted || (cmdOfCall(s) === o.cmd && !!s.result?.error === !!o.failed)));

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
/** How long an agent that has done nothing yet in its turn is said to be being reached. */
const REACH = 4000;

/** The card open out of a row: key the row, group its steps (their places), at the one chosen. */
type Card = { key: string; at: string; group: string[]; el: HTMLElement; open: boolean };

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
  // Nothing to open till it has done a step: before that it only says it is being reached (kumo, 2026-11-24).
  const opens = from !== undefined && (steps > 0 || !!span);
  const open = useOpen(channel, n) && opens;
  const blocks = useSpan(session, from);
  const [card, setCard] = useState<Card | null>(null);
  const [only, setOnly] = useState<Only | null>(null);
  // Before its first step: being reached for its first REACH ms, thinking after (kumo, 2026-11-24).
  const began = work?.at ?? 0;
  const [reached, setReached] = useState(() => !began || Date.now() - began >= REACH);
  useEffect(() => {
    if (reached || !work?.running || work.steps) return;
    const id = setTimeout(() => setReached(true), Math.max(0, REACH - (Date.now() - began)));
    return () => clearTimeout(id);
  }, [reached, began, work?.running, work?.steps]);
  const reveal = useRef<HTMLDivElement>(null);
  // All its steps, a row each (kumo, 2026-11-24: 直接全展开): as many rows as the work says it
  // has, so that it is whole as it opens, before they are read.
  const rows = work ? Math.max(steps, 1) : undefined;
  const read = () => from !== undefined && void (work ? readSteps(session, from, undefined, steps) : readSteps(session, from, to)).catch(() => {});
  // Read as it is drawn (its line says what was done by its sorts, as its record has it), and
  // again as its steps go on while it is open.
  useEffect(() => void ((open || !running) && read()), [open, steps, running, to]);
  const limit = work ? Math.max(steps, 1) : undefined;
  const all = useMemo(() => (blocks ? allStepsOf(blocks, running, limit) : undefined), [blocks, running, limit]);
  const runs = useMemo(() => (all && !running ? foldLine(all) : []), [all, running]);
  const diff = useMemo(() => diffSum(runs), [runs]);
  const parts = did && !work ? didParts(did) : [];
  if (!work && !parts.length) return null;
  /** Opened or put away; to: narrowed to that sort (pressed again while it is: put away; another
   *  while open: narrowed to that one instead, still open). */
  const toggle = (to: Only | null = null) => {
    if (!opens) return;
    // A person's doing: the conversation follows its height quickly (stick.tsx).
    if (reveal.current) byHand(reveal.current);
    setCard((c) => c && { ...c, open: false });
    const stays = open && !!to && !sameOnly(to, only);
    if (!open) read();
    // Put away, it keeps what it showed: its rows go as they were, not all of them put in first
    // and then shut (kumo, 2026-11-25: 收起时把所有的排了一遍再收起).
    if (!open || stays) setOnly(to);
    if (!stays) setOpen(channel, n, !open);
  };
  return (
    <div className="min-w-0">
      <div className="flex h-7 min-w-0 items-center gap-1.5 text-sm text-ink-3 pointer-coarse:h-9">
        {/* The key that opens all of it, before the rest; where it worked, pressed, the same. */}
        <button
          type="button"
          aria-expanded={opens ? open : undefined}
          disabled={!opens}
          onPointerEnter={read}
          onPointerDown={read}
          onFocus={read}
          onClick={() => toggle()}
          className={cn("flex h-full min-w-0 items-center gap-1.5 rounded-sm text-left outline-none", running || !runs.length ? "flex-1" : "shrink-0", opens && "cursor-pointer hover:text-ink-2 focus-visible:text-ink-2", open && !only && "text-ink-2")}
        >
          {opens && <ChevronRight size={13} aria-hidden className={cn("shrink-0 text-ink-4 transition-transform duration-(--dur-2)", open && "rotate-90")} />}
          {away && <Where place={away} short />}
          {work ? (
            running ? (
              <>
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-run" />
                <span key={`s${steps}${reached ? "r" : ""}`} className="g-fade shrink-0 tabular-nums">
                  {steps ? t("work.step", { n: steps }) : reached ? t("work.thinking") : t("work.reaching")}
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
              !runs.length && (
                <span key="done" className="flex min-w-0 items-center gap-2 tabular-nums">
                  <span className="shrink-0">{steps === 1 ? t("work.step1") : t("work.steps", { n: steps })}</span>
                </span>
              )
            )
          ) : (
            !runs.length && (
              <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap tabular-nums">
                {parts.map((p, i) => (
                  <span key={i} className={cn(i === parts.length - 1 ? "min-w-0 truncate" : "shrink-0")}>
                    {p}
                  </span>
                ))}
              </span>
            )
          )}
        </button>
        {/* What was done, by its sorts, as before (kumo, 2026-11-24): each pressed opens its own
            steps alone. */}
        {!running && runs.length > 0 && all && (
          <span className="g-fade flex min-w-0 flex-1 items-center gap-3 overflow-hidden whitespace-nowrap">
            {runs.map((r) => {
              const groups = r.name ? runCmds(all, r.name) : [{ cmd: undefined, n: r.n, failed: false }];
              const apart = groups.length > 1 || isShell(r.name);
              const key = (o: Only) => cn("flex h-7 shrink-0 cursor-pointer items-center gap-0.5 rounded-sm outline-none hover:text-ink-2 focus-visible:text-ink-2 pointer-coarse:h-9", open && sameOnly(o, only) && "text-ink");
              if (apart)
                return (
                  <span key={r.name} className="flex shrink-0 items-center gap-1.5">
                    {groups.map((g, j) => {
                      const o: Only = { name: r.name, sorted: true, ...(g.cmd ? { cmd: g.cmd } : {}), ...(g.failed ? { failed: true } : {}) };
                      return (
                        <button key={j} type="button" onClick={() => toggle(o)} aria-pressed={open && sameOnly(o, only)} className={key(o)}>
                          <KindIcon kind={kindOf(r.name)} cmd={g.cmd} shell={isShell(r.name)} failed={g.failed} />
                          {g.n > 1 && <span className={cn("text-xs tabular-nums", g.failed && "text-err")}>×{g.n}</span>}
                        </button>
                      );
                    })}
                  </span>
                );
              const o: Only = { name: r.name };
              return (
                <button key={r.name} type="button" onClick={() => toggle(o)} aria-pressed={open && sameOnly(o, only)} className={cn(key(o), "gap-1.5")}>
                  <KindIcon kind={r.name ? kindOf(r.name) : "thinking"} cmd={groups[0]?.cmd} failed={groups[0]?.failed} />
                  <span className="text-ink-2">{r.name || t("msg.thinking")}</span>
                  {r.n > 1 && <span className="text-xs tabular-nums">×{r.n}</span>}
                </button>
              );
            })}
            {diff && <DiffStat d={diff} />}
          </span>
        )}
        {!running && !!work?.agents && <span className="shrink-0 text-xs tabular-nums">{t("work.agents", { n: work.agents })}</span>}
        {!running && !!work?.ms && <span className="ml-auto shrink-0 pl-2 text-xs text-ink-4 tabular-nums">{tookWords(work.ms)}</span>}
        {running && may && <StopKey session={session} esc={esc} />}
      </div>
      {opens && <StepList reveal={reveal} session={session} steps={all} only={only} rows={only || !rows ? undefined : rows} open={open} card={card} setCard={setCard} shut={() => toggle()} />}
    </div>
  );
}

/** Where a step's card opens: under its row, from a fixed way in, so the rows' keys and names to
 *  its left stay seen and pressed one after another (kumo, 2026-11-25); where the pane is too
 *  narrow, as far left as it must. A finger's screen: from the row's start. */
const ASIDE = 176;
const aside = (el: Element) => ({
  getBoundingClientRect: () => {
    const r = el.getBoundingClientRect();
    const by = matchMedia("(pointer: coarse)").matches ? 0 : Math.min(ASIDE, r.width / 2);
    return new DOMRect(r.left + by, r.top, r.width - by, r.height);
  },
});

/** The steps under a line, opened in place: a row each, all of them, none scrolled in the list
 *  itself. A row pressed: its card out of the row; pressed again, or a press elsewhere, puts it away. */
function StepList({ reveal, session, steps, only, rows, open, card, setCard, shut }: { reveal: RefObject<HTMLDivElement | null>; session: string; steps?: Step[]; only: Only | null; rows?: number; open: boolean; card: Card | null; setCard: (c: Card | null) => void; shut: () => void }) {
  const list = useMemo(() => (steps ?? []).filter((s) => isOnly(s, only)), [steps, only]);
  // Made as it is first opened.
  const ever = useEver(open);
  const wasOn = useRef("");
  // Opened already as it is first drawn (kept open): there at once, not opening under the eyes.
  const [snap, setSnap] = useState(open);
  useEffect(() => {
    if (!snap) return;
    const f = requestAnimationFrame(() => setSnap(false));
    return () => cancelAnimationFrame(f);
  }, [snap]);
  // A press anywhere but on the card puts it away.
  useEffect(() => {
    if (!card?.open) return;
    const down = (e: PointerEvent) => {
      const on = e.target as Element;
      if (on.closest?.("[role=dialog]")) return;
      // On its own row: that press puts it away, and the click that follows does not open it again.
      wasOn.current = on.closest?.<HTMLElement>("[data-step-row]")?.dataset.stepRow === card.key ? card.key : "";
      setCard({ ...card, open: false });
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [card]);
  const among = card ? list.filter((s) => card.group.includes(s.at)) : [];
  const chosen = card ? (among.find((s) => s.at === card.at) ?? among[0]) : undefined;
  const row = (key: string, group: Step[], body: ReactNode) => {
    const on = !!card?.open && card.key === key;
    return (
      <button
        key={key}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={on}
        data-step-row={key}
        onClick={(e) => {
          // Pressed while its card was open: the card is put away (the press outside it did that
          // already), not opened again.
          const shut = on || wasOn.current === key;
          wasOn.current = "";
          setCard(shut ? (card ? { ...card, open: false } : null) : { key, at: group[0]!.at, group: group.map((s) => s.at), el: e.currentTarget, open: true });
        }}
        className={cn(ROW, "w-full shrink-0 text-left outline-none focus-visible:text-ink-2", on && "text-ink")}
      >
        {body}
      </button>
    );
  };
  const tookAll = (ss: Step[]) => {
    const ts = ss.map(tookOf);
    return ts.some((x) => x === undefined) ? undefined : ts.reduce<number>((a, b) => a + (b ?? 0), 0);
  };
  const took = (ss: Step[]) => {
    const ms = tookAll(ss);
    return ms !== undefined && <span className="ml-auto shrink-0 pl-2 text-xs text-ink-4 tabular-nums">{lasted(ms)}</span>;
  };
  return (
    <>
      <div ref={reveal} inert={!open || undefined} aria-hidden={!open || undefined} className={cn("g-reveal", snap && "g-snap")} data-open={open ? "" : undefined}>
        <div className="min-h-0 min-w-0 overflow-hidden">
          {ever && (
            <div style={rows ? ({ "--rows": Math.max(rows, list.length) } as CSSProperties) : undefined} className={cn("ml-[3px] flex min-w-0 flex-col overflow-hidden pl-3 shadow-[inset_1px_0_0_var(--edge)]", !!rows && "min-h-[calc(var(--rows)*28px)] pointer-coarse:min-h-[calc(var(--rows)*36px)]")}>
              {/* Its record not read yet: as many quiet rows as it has steps, where they come (kumo,
                  2026-11-25: an empty box with its line read as broken). */}
              {!steps &&
                Array.from({ length: rows ?? 0 }, (_, i) => (
                  <span key={i} aria-hidden className={cn(ROW, "w-full shrink-0 hover:text-ink-3")}>
                    <span className="size-3.5 shrink-0 rounded-sm bg-fill-2" />
                    <span className="h-2 rounded-full bg-fill-2" style={{ width: `${28 + ((i * 37) % 40)}%` }} />
                  </span>
                ))}
              {list.map((s) =>
                row(
                  s.at,
                  [s],
                  <>
                    <StepLine s={s} />
                    {took([s])}
                  </>,
                ),
              )}
            </div>
          )}
          {/* Put away from its end too, where a long one leaves its line far above (kumo,
              2026-11-24): the whole row from the left edge, under the line's own key, the line
              over it ending before it. */}
          {ever && (
            <button type="button" onClick={shut} className={cn(ROW, "w-full shrink-0 cursor-pointer gap-1.5 text-left text-xs text-ink-4 outline-none hover:text-ink-2 focus-visible:text-ink-2")}>
              <ChevronRight size={13} aria-hidden className="shrink-0 -rotate-90" />
              {t("nav.less")}
            </button>
          )}
        </div>
      </div>
      {ever && (
        <Popover.Root open={!!card?.open && !!chosen} onOpenChange={(o) => !o && card && setCard({ ...card, open: false })}>
          <PopSurface anchor={card?.el && aside(card.el)} still sideOffset={4} className="flex max-h-[min(72dvh,620px,var(--available-height))] w-[min(620px,calc(100vw-16px))] flex-col overflow-hidden">
            {chosen && card && (
              <>
                {among.length > 1 && (
                  <div className="flex max-h-[168px] shrink-0 flex-col overflow-y-auto overscroll-contain border-b border-edge px-3 py-1 pointer-coarse:max-h-[216px]">
                    {among.map((s) => (
                      <button key={s.at} type="button" aria-pressed={s.at === chosen.at} onClick={() => setCard({ ...card, at: s.at })} className={cn(ROW, "w-full shrink-0 text-left outline-none focus-visible:text-ink-2", s.at === chosen.at && "text-ink")}>
                        <StepLine s={s} />
                        {took([s])}
                      </button>
                    ))}
                  </div>
                )}
                <StepCard key={chosen.at} s={chosen} session={session} />
                {chosen.kind === "tool" && !!chosen.result?.images?.length && (
                  <div className="px-3 pb-3">
                    <Pictures session={session} s={chosen} />
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
