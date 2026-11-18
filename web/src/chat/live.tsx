// What a turn shows while nothing is in the transcript yet (the user, 2026-11-06: no blank while the
// agent writes): a tool call as it is written, its command typed out live; and, when the turn has
// gone quiet a moment, three dots breathing at the conversation's end. And the key that stops it:
// stopping is the agent's that runs, on its row at work, not the composer's (kumo, 2026-11-16).
import { LoaderCircle, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { t } from "../i18n";
import { errText, toast } from "../toast";
import { cn, IconKey } from "../ui";
import { cmdOfCall, isShell } from "./cmd";
import { toldOf } from "./dispatch";
import { Sent } from "./dispatched";
import { argOf, kindOf } from "./fold";
import { partialInput, tail } from "./partial";
import { KindIcon } from "./said";

/** A tool call being written: its icon and name at once, a light sweeping across them, then what
 *  it is about typed out as it comes (no caret: the user, 2026-11-06); written whole, it waits for its block. */
export function ToolDraft({ name, input, plain }: { name: string; input: string; whole?: boolean; plain?: boolean }) {
  const call = { name, input: JSON.stringify(partialInput(input)) };
  const a = argOf(call);
  // Words to a subagent: as they are drawn once written (dispatched.tsx).
  if (toldOf(call)) return <Sent call={call} live />;
  return (
    <div className={cn(!plain && "g-fade", "flex h-7 min-w-0 items-center gap-2 text-sm")} aria-live="off">
      <KindIcon kind={kindOf(name)} cmd={cmdOfCall(call)} shell={isShell(name)} />
      {/* A shell's name only till its command comes. */}
      {!(isShell(name) && a.arg) && <span className="shine shrink-0">{name}</span>}
      {a.arg ? (
        <span className={cn("min-w-0 truncate text-ink-3", a.code ? "font-mono text-xs" : "text-xs")}>{tail(a.arg)}</span>
      ) : (
        <span className="shine min-w-0 truncate text-xs">{t("chat.writingCall")}</span>
      )}
    </div>
  );
}

/** How long a turn may show nothing new before the dots come. */
const QUIET = 600;

/** Three dots breathing one after another at the conversation's end, while the turn runs and has
 *  shown nothing new for a moment (thinking, the network, a message not taken yet). quiet: what
 *  changes as something new shows; the dots wait QUIET again from then. */
export function Waiting({ on, quiet }: { on: boolean; quiet: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    if (!on) return;
    const timer = setTimeout(() => setShown(true), QUIET);
    return () => clearTimeout(timer);
  }, [on, quiet]);
  if (!on || !shown) return null;
  return (
    <div className="g-fade flex h-7 items-center gap-1 pl-0.5" role="status" aria-label={t("chat.working")}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="wait-dot" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </div>
  );
}

/** Ends session's turn: the one act behind the stop key of an agent at work, 停止 in its face's
 *  menu, /stop and Esc. */
export const stopTurn = (session: string): Promise<void> =>
  api.interrupt(session).then(
    () => {},
    (e) => void toast(t("err.stop"), { error: true, description: errText(e) }),
  );

/** The stop key of an agent at work, at the right of its row (chat.tsx Activity, the compaction's
 *  line; channel/page.tsx AtWork): the session's own agent or another of the channel alike. esc:
 *  Esc in the composer does the same (the session's own agent). */
const stopGone = new Map<string, number>();
export function StopKey({ session, esc }: { session: string; esc?: boolean }) {
  const [stopping, setStopping] = useState(false);
  // Put in again at once (the turn's row moved under its first words): there already, no fading
  // in a second time.
  const [again] = useState(() => performance.now() - (stopGone.get(session) ?? -1e9) < 300);
  useEffect(() => () => void stopGone.set(session, performance.now()), [session]);
  return (
    <IconKey label={t(esc ? "chat.stopEsc" : "channel.stop")} tipSide="left" disabled={stopping} onClick={() => (setStopping(true), void stopTurn(session).finally(() => setStopping(false)))} className={cn(!again && "g-fade", "ml-auto size-6 text-ink-3 pointer-coarse:size-8")}>
      {stopping ? <LoaderCircle size={12} className="animate-spin" /> : <Square size={10} fill="currentColor" />}
    </IconKey>
  );
}
