// The container of work done away from the channel's folder (the user, 2026-11-18): the steps an
// agent took in another folder or at another computer sit in one plain box that says where; its
// words, said to the channel, stay on the page outside it. One box for both: a computer has its
// face, its name and its link's lamp; a folder here its mark and its name. Nothing scrolls inside
// it: a finished turn's is one line until pressed, its height gliding.
import { ChevronRight, Folder, ListTree } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useMachines } from "../data";
import { t, useLang } from "../i18n";
import { LINK_COLOR, MachineFace, shownPath, useLink, type Machine } from "../machines";
import type { Place } from "../places";
import { useList } from "../store";
import { cn, tilde } from "../ui";
import { awayOf, folderName } from "./awayof";
import { FlatSteps } from "./said";

/** Where session works when that is not channel's folder: both as the list has them. */
export function useAway(channel: string, session: string): Place | undefined {
  const list = useList();
  if (channel === session) return undefined;
  const home = list?.find((x) => x.id === channel);
  const at = list?.find((x) => x.id === session);
  // Known only while both rows are listed. As last known meanwhile (the list not come yet, a row
  // gone from it while its computer's link is down): what was in the box stays in it, not out of
  // it and in again each time the link comes and goes (kumo, 2026-11-19).
  const key = `${channel} ${session}`;
  if (home?.cwd && at?.cwd) lastAway.set(key, awayOf(home, at));
  return lastAway.get(key);
}
const lastAway = new Map<string, Place | undefined>();

/** The computers as last listed, by id: one not listed for a moment keeps its name and face. */
const lastMachine = new Map<string, Machine>();

/** When an agent's work at a place was last drawn open, at work (by its session): its box of a
 *  turn's part just said is then drawn open and folds, not gone to one line at once. */
const lastLive = new Map<string, number>();
const JUST = 1500;

/** A computer's link: its lamp, and 已断开 once it has stayed away. */
function Link({ m }: { m: Machine }) {
  const link = useLink(m);
  return (
    <>
      <span role="img" aria-label={link === "away" ? t("status.offline") : undefined} className="size-1.5 shrink-0 rounded-full" style={{ background: LINK_COLOR[link] }} />
      {link === "away" && <span className="shrink-0 whitespace-nowrap text-err">{t("status.offline")}</span>}
    </>
  );
}

/** The line that says where: the mark, the name (never wrapped: cut short), the path after it,
 *  a gap between them and no dot (docs/前端设计规范.md: 不用“·”分隔). */
function Where({ place }: { place?: Place }) {
  const ms = useMachines();
  // In the channel's own folder: no place to say, only what the box is.
  if (!place)
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <ListTree size={14} className="shrink-0" aria-hidden />
        <span className="truncate font-medium text-ink-2">{t("msg.earlier")}</span>
      </span>
    );
  for (const x of ms) lastMachine.set(x.id, x);
  const m = place.machine ? (ms.find((x) => x.id === place.machine) ?? lastMachine.get(place.machine)) : undefined;
  const path = m ? shownPath(`${m.id}:${place.path.replaceAll("\\", "/")}`, ms).label : tilde(place.path);
  const name = m?.name ?? place.machine ?? folderName(place.path);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5" title={`${place.machine ? `${name}:` : ""}${place.path}`}>
      {m ? <MachineFace m={m} size={16} className={cn(!m.online && "opacity-50 grayscale")} /> : <Folder size={14} className="shrink-0" aria-hidden />}
      <span className="max-w-[55%] shrink-0 truncate font-medium text-ink-2">{name}</span>
      {m && <Link m={m} />}
      <span className="min-w-0 truncate">{m && place.machine && m.sep === "\\" ? path.replaceAll("/", "\\") : path}</span>
    </span>
  );
}

// Two thirds of the column on a computer, and light (kumo, 2026-11-24: not the whole width, less grey).
const BOX = "-mx-2.5 min-w-0 rounded-xl bg-fill/50 px-2.5 sm:mr-0 sm:w-2/3";
const HEAD = "flex h-8 w-full min-w-0 items-center gap-2 text-left text-xs text-ink-3 pointer-coarse:h-9";

/** place: where, when that is not the channel's folder; none: the work of an agent in the
 *  channel's folder, in the same box (kumo, 2026-11-24: every agent's steps drawn this one way: a
 *  message of the channel is its steps in one line, then its words). */
/** Work at place, in its box. count: a finished turn's, how many steps it holds: one line, pressed
 *  open and shut; undefined: a turn at work, open while it lasts. */
export function AwayBox({ place, count, session, children }: { place?: Place; count?: number; session?: string; children: ReactNode }) {
  useLang();
  const folds = count !== undefined;
  // Just now open at work: open still, then folding (its height gliding), as a turn's earlier
  // rows fold when it ends.
  const [fresh] = useState(() => folds && !!session && performance.now() - (lastLive.get(session) ?? -1e9) < JUST);
  const [open, setOpen] = useState(!folds || fresh);
  useEffect(() => {
    if (!folds && session) lastLive.set(session, performance.now());
  });
  useEffect(() => {
    if (!folds && session) return () => void lastLive.set(session, performance.now());
    if (!fresh) return;
    const f = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(false)));
    return () => cancelAnimationFrame(f);
  }, []);
  if (!folds)
    return (
      <div className={BOX}>
        <div className={HEAD}>
          <Where place={place} />
        </div>
        <div className="flex min-w-0 flex-col gap-1 pt-1 pb-2"><FlatSteps.Provider value>{children}</FlatSteps.Provider></div>
      </div>
    );
  return (
    <div className={cn(BOX, "mb-1.5")}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cn(HEAD, "cursor-default hover:text-ink-2")}>
        <Where place={place} />
        {count > 0 && <span className="shrink-0 tabular-nums">×{count}</span>}
        <ChevronRight size={13} className={cn("shrink-0 text-ink-4 transition-transform duration-(--dur-2)", open && "rotate-90")} />
      </button>
      <div inert={!open || undefined} aria-hidden={!open || undefined} className="g-reveal" data-open={open ? "" : undefined}>
        <div className="min-h-0 min-w-0 overflow-hidden">
          <div className="flex min-w-0 flex-col gap-1 pt-1 pb-2.5"><FlatSteps.Provider value>{children}</FlatSteps.Provider></div>
        </div>
      </div>
    </div>
  );
}
