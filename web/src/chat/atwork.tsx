// A turn at work as it shows at the conversation's end: the row of what is being written or run
// (Activity), and another agent of the channel at work (OtherTurn), drawn as its own page draws
// its turn (kumo, 2026-11-18: what an agent does looks the same wherever one looks at it), not
// dots alone.
import { useEffect, useState, type ReactNode } from "react";
import type { SessionState as LiveSession } from "../api/types.gen";
import { chatOf, fresh, type Draft as Drafted } from "../chats";
import { t, useLang } from "../i18n";
import { openChat } from "../route";
import { carries, opened } from "../stream";
import { cn } from "../ui";
import { liveOf, type AgentRow, type Src } from "./channel/lib";
import { AgentFace } from "./channel/members";
import { AwayBox, useAway } from "./away";
import { folded, type Tool } from "./fold";
import { StopKey, ToolDraft, Waiting } from "./live";
import { Earlier, Running, Said, When, useWhenRow } from "./said";
import { earlierOf } from "./turns";

/** The turn's row at the end of the conversation: the call being written, else the one running
 *  (the newest, how many more beside it), else the dots once it has gone quiet; one line high, even
 *  empty, while the turn lasts. */
/** under: in a turn's frame of its own, under the face and name (the turn's first). stop: the
 *  agent's stop key, at the row's right. */
export function Activity({ calls, running, cwd, quiet, grew, under, stop }: { calls: Drafted[]; running: Tool[]; cwd: string; quiet: boolean; grew: string; under?: boolean; stop?: ReactNode }) {
  const writing = calls.at(-1);
  const run = running.at(-1);
  return (
    <div className={cn("flex h-7 min-w-0 items-center pointer-coarse:h-9", under ? "-mt-1" : "-mt-3 pl-[38px]")}>
      {/* One box for a call, written then running, under its id: it fades in once, not again
          as the call written begins to run. */}
      {writing?.tool ? (
        <div key={writing.tool.id} className="g-fade flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0 flex-1">
            <ToolDraft name={writing.tool.name} input={writing.text} whole={writing.whole} plain />
          </div>
        </div>
      ) : run ? (
        <div key={run.id ?? run.at} className="g-fade flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0 flex-1">
            <Running tool={run} cwd={cwd} />
          </div>
          {running.length > 1 && <span className="shrink-0 text-xs text-ink-4 tabular-nums">+{running.length - 1}</span>}
        </div>
      ) : (
        <Waiting on={quiet} quiet={grew} />
      )}
      {stop}
    </div>
  );
}

/** A turn's frame: the face at the left, the head's line over the rest. */
export function TurnFrame({ face, head, children }: { face: ReactNode; head: ReactNode; children: ReactNode }) {
  const row = useWhenRow();
  return (
    <div {...row} className={cn(row.className, "flex min-w-0 items-start gap-2.5")}>
      {face}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="-mb-3.5 flex h-4 min-w-0 items-center gap-1.5">{head}</div>
        {children}
      </div>
    </div>
  );
}

/** Its blocks are drawn as its own page draws them: who sent words is not asked (what it was
 *  given is the channel's, drawn there). */
const noSource = () => ({ kind: "you" }) as ReturnType<Parameters<typeof Said>[0]["source"]>;

/** Another agent of the channel at work: its face and name, as its words will be, then what it
 *  has done in this turn since it last spoke in the channel, read from its record as it grows
 *  (its state's end on the stream), folded as its own page folds a turn at work; the call it
 *  runs, or the dots, and its stop key at the end. alone: under its own last words, no face
 *  again. said: where its last words in the channel are from in its record (their work is
 *  under them). */
export function OtherTurn({ a, channel, st, said, alone, bars, call, record, may }: { a: AgentRow; channel: string; st?: LiveSession; said?: Src; alone: boolean; bars: ReactNode; call?: (nick: string) => void; record: (session: string) => void; may: boolean }) {
  useLang();
  const [chat] = useState(() => chatOf(a.session));
  const log = chat.log;
  const [, redraw] = useState(0);
  const changed = () => redraw((n) => n + 1);
  useEffect(() => {
    let live = true;
    const more = () => void log.newer().then(() => live && changed(), () => {});
    if (!log.loaded || !fresh(log.came)) more();
    opened.add(more);
    return () => {
      live = false;
      opened.delete(more);
    };
  }, [a.session]);
  // Its record grew: what came since.
  const carried = carries(`session:${a.session}`);
  const end = st?.end ?? 0;
  useEffect(() => {
    if (!log.loaded || (carried && end <= log.end)) return;
    let live = true;
    void log.newer().then(() => live && changed(), () => {});
    return () => void (live = false);
  }, [end, log.loaded]);
  const away = useAway(channel, a.session);
  const shown = folded(liveOf(log.blocks, said));
  const running = shown.flatMap((b) => (b.kind === "running" ? [b.tool] : []));
  const rows = shown.filter((b) => b.kind !== "running" && b.kind !== "user");
  const cwd = st?.cwd ?? "";
  const node = (b: (typeof rows)[number]) => <Said key={b.at} b={b} session={a.session} cwd={cwd} source={noSource} onJump={openChat} />;
  const e = earlierOf(rows, (b) => b.kind === "assistant");
  // All its rows in the one place from the first (Earlier's after): none is put in again as it
  // comes to be among the earlier ones.
  const body = rows.length ? (
    <Earlier key="earlier" done={false} bare={!e} words={e?.words ?? 0} steps={(e?.before ?? []).reduce((n, b) => n + (b.kind === "fold" ? b.steps.length : 0), 0)} after={(e?.after ?? rows).map(node)}>
      {(e?.before ?? []).map(node)}
    </Earlier>
  ) : null;
  const stop = may ? <StopKey session={a.session} /> : null;
  const time = rows.map((b) => (b.kind === "fold" ? b.steps[0]?.time : "time" in b ? b.time : undefined)).find(Boolean);
  const activity = (under: boolean) => <Activity calls={[]} running={running} cwd={cwd} quiet grew={`${a.session} ${log.end} ${running.length}`} under={under} stop={stop} />;
  const headOf = () => (
    <>
      <span className="shrink-0 text-xs font-medium text-ink-2">{a.nick}</span>
      <span className="min-w-0 truncate text-xs text-ink-4">{a.name}</span>
      {bars}
      <When time={time} />
    </>
  );
  const label = `${a.nick} · ${t("chat.working")}`;
  // At work away from the channel's folder: all of the turn in the box that says where
  // (away.tsx), the row of what runs now at its end; its words come out of it as it says them.
  if (away) {
    const box = (
      <AwayBox place={away}>
        {body}
        {activity(true)}
      </AwayBox>
    );
    return (
      <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-5">
        {alone ? <div className="pl-[38px]">{box}</div> : <TurnFrame face={<AgentFace channel={channel} a={a} call={call} record={record} may={may} />} head={headOf()}>{box}</TurnFrame>}
      </div>
    );
  }
  if (alone)
    return (
      <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-5">
        {rows.length > 0 && <div className="flex min-w-0 flex-col gap-5 pl-[38px]">{body}</div>}
        {activity(false)}
      </div>
    );
  const face = <AgentFace channel={channel} a={a} call={call} record={record} may={may} />;
  const head = headOf();
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-5">
      {rows.length ? (
        <>
          <TurnFrame face={face} head={head}>
            {body}
          </TurnFrame>
          {activity(false)}
        </>
      ) : (
        <TurnFrame face={face} head={head}>
          {activity(true)}
        </TurnFrame>
      )}
    </div>
  );
}
