// The container of work done away from the channel's folder (the user, 2026-11-18): the steps an
// agent took in another folder or at another computer sit in one plain box that says where; its
// words, said to the channel, stay on the page outside it. One box for both: a computer has its
// face, its name and its link's lamp; a folder here its mark and its name. Nothing scrolls inside
// it: a finished turn's is one line until pressed, its height gliding.
import { ChevronRight, Folder } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useMachines } from "../data";
import { t, useLang } from "../i18n";
import { LINK_COLOR, MachineFace, shownPath, useLink, type Machine } from "../machines";
import type { Place } from "../places";
import { useList } from "../store";
import { cn, tilde } from "../ui";
import { awayOf, folderName } from "./awayof";

/** Where session works when that is not channel's folder: both as the list has them. */
export function useAway(channel: string, session: string): Place | undefined {
  const list = useList();
  if (channel === session) return undefined;
  return awayOf(list?.find((x) => x.id === channel), list?.find((x) => x.id === session));
}

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

/** The line that says where: the mark, the name (never wrapped: cut short), the path after it. */
function Where({ place }: { place: Place }) {
  const ms = useMachines();
  const m = place.machine ? ms.find((x) => x.id === place.machine) : undefined;
  const path = m ? shownPath(`${m.id}:${place.path.replaceAll("\\", "/")}`, ms).label : tilde(place.path);
  const name = m?.name ?? place.machine ?? folderName(place.path);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5" title={`${place.machine ? `${name}:` : ""}${place.path}`}>
      {m ? <MachineFace m={m} size={16} className={cn(!m.online && "opacity-50 grayscale")} /> : <Folder size={14} className="shrink-0" aria-hidden />}
      <span className="max-w-[55%] shrink-0 truncate font-medium text-ink-2">{name}</span>
      {m && <Link m={m} />}
      <span className="min-w-0 truncate">· {m && place.machine && m.sep === "\\" ? path.replaceAll("/", "\\") : path}</span>
    </span>
  );
}

const BOX = "-mx-2.5 min-w-0 rounded-xl bg-fill px-2.5";
const HEAD = "flex h-8 w-full min-w-0 items-center gap-2 text-left text-xs text-ink-3 pointer-coarse:h-9";

/** Work at place, in its box. count: a finished turn's, how many steps it holds: one line, pressed
 *  open and shut; undefined: a turn at work, open while it lasts. */
export function AwayBox({ place, count, children }: { place: Place; count?: number; children: ReactNode }) {
  useLang();
  const folds = count !== undefined;
  const [open, setOpen] = useState(!folds);
  if (!folds)
    return (
      <div className={BOX}>
        <div className={HEAD}>
          <Where place={place} />
        </div>
        <div className="flex min-w-0 flex-col gap-5 pt-1 pb-2">{children}</div>
      </div>
    );
  return (
    <div className={cn(BOX, "mb-1.5")}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={cn(HEAD, "cursor-default hover:text-ink-2")}>
        <Where place={place} />
        {count > 0 && <span className="shrink-0 tabular-nums">×{count}</span>}
        <ChevronRight size={13} className={cn("shrink-0 text-ink-4 transition-transform duration-(--dur-2)", open && "rotate-90")} />
      </button>
      <div inert={!open || undefined} aria-hidden={!open || undefined} className={cn("grid transition-[grid-template-rows] duration-(--dur-2) ease-(--ease-out)", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="min-h-0 min-w-0 overflow-hidden">
          <div className="flex min-w-0 flex-col gap-3 pt-1 pb-2.5">{children}</div>
        </div>
      </div>
    </div>
  );
}
