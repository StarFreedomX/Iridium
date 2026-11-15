// What a session's page holds of its channel once the channel has another agent (kumo, 2026-11-15:
// the page is not swapped, another agent is one more member): its log, its other agents' states,
// how far each has read, the code that draws them. A session alone costs nothing of this. The
// code and the log's newest page are asked for together as a second agent comes, and drawn only
// once both are in: what they bring shows in its place at once, nothing drawn empty first.
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { ChannelReads, Session, SessionState as LiveSession } from "../../api/types.gen";
import { stateAhead } from "../../chats";
import { getCarried, onCarried, setCarried, useCarried } from "../../store";
import { also, carries, events, opened, type SatoriEvent } from "../../stream";
import { isMulti, watchExtra } from "./lib";
import { channelLog, type ChannelLog, type Kept } from "./log";

type Parts = typeof import("./page");

/** The channel page's parts (page.tsx), once fetched: drawn straight from it, no suspense. */
let parts: Parts | undefined;
let partsComing: Promise<Parts> | undefined;
const loadParts = () => (partsComing ??= import("./page").then((m) => (parts = m)));

/** Channels seen here with another agent: the log stays in once it was, so their words do not
 *  go as an agent leaves (and come back as it returns). */
const several = new Set<string>();

/** The states of these sessions, as carried; drawn again as any of them changes. */
function useStates(ids: string[]): (LiveSession | undefined)[] {
  const [, redraw] = useState(0);
  const key = ids.join(" ");
  useEffect(() => onCarried((k) => k.startsWith("session:") && ids.includes(k.slice(8)) && redraw((n) => n + 1)), [key]);
  return ids.map((id) => getCarried<LiveSession>(`session:${id}`));
}

export type Side = {
  /** Whether the page holds its channel's side at all. */
  on: boolean;
  /** The parts and the log, once both are in; until then nothing of it is drawn. */
  ready: { parts: Parts; kept: Kept } | undefined;
  /** The channel's agents (its own first) and their states, as the list has them. */
  sessions: string[];
  states: (LiveSession | undefined)[];
  reads: ChannelReads | undefined;
  /** Bumped as the log changes. */
  version: number;
};

/** A session's channel as its page holds it. row: its row in the list; may: the one looking is
 *  of its people (its reads are said only then). */
export function useSide(id: string, row: Session | undefined, may: boolean): Side {
  if (isMulti(row)) several.add(id);
  const on = several.has(id);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((n) => n + 1);
  const kept = on ? channelLog(id) : undefined;
  const sessions = on ? (row?.agents ?? []).map((a) => a.session) : [];
  const states = useStates(sessions);

  // The code and the newest page together, then each message as its event brings it; what the
  // events may have missed, once the stream is back.
  useEffect(() => {
    if (!kept) return;
    let live = true;
    const more = () => void kept.log.newer().then(() => live && bump(), () => {});
    void loadParts().then(() => live && bump());
    more();
    const hear = (e: SatoriEvent) => {
      if (e.type !== "message-created" || e.channel?.id !== id || !e.message) return;
      kept.log.heard({ ...e.message, _data: { ...e._data, ...e.message._data } });
      bump();
    };
    events.add(hear);
    opened.add(more);
    return () => {
      live = false;
      events.delete(hear);
      opened.delete(more);
    };
  }, [id, on]);

  // The other agents' states: the stream carries them as far as it has room; the rest asked for
  // as the list says they moved.
  const key = sessions.join(" ");
  useEffect(() => {
    if (!on) return;
    also(watchExtra(id, sessions));
    for (const x of sessions) if (!getCarried(`session:${x}`)) void stateAhead(x);
    return () => also([]);
  }, [id, key, on]);
  const moved = sessions.map((x) => `${x}:${states[sessions.indexOf(x)]?.status}:${states[sessions.indexOf(x)]?.end}`).join(" ");
  useEffect(() => {
    if (!on) return;
    sessions.forEach((x) => {
      if (x === id || carries(`session:${x}`)) return;
      void api.session(x, { priority: "low" } as RequestInit).then(
        (st) => setCarried(`session:${x}`, st),
        () => {},
      );
    });
    // An agent's turn moved: what it said may be in the log now.
    if (kept?.log.loaded) void kept.log.newer().then(bump, () => {});
  }, [moved]);

  // How far each member has read: asked once, then as the stream brings it; this page has read
  // what it shows, said as the log's end moves while the tab is in front.
  const reads = useCarried<ChannelReads>(`reads:${id}`);
  useEffect(() => {
    if (!on) return;
    void api.reads(id).then(
      (r) => getCarried(`reads:${id}`) || setCarried(`reads:${id}`, r),
      () => {},
    );
  }, [id, on]);
  const [seen, setSeen] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const look = () => setSeen(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, []);
  const end = kept?.log.loaded ? kept.log.end : 0;
  useEffect(() => {
    if (!end || !may || !seen) return;
    const timer = setTimeout(() => void api.read(id, end).then((r) => setCarried(`reads:${id}`, r), () => {}), 600);
    return () => clearTimeout(timer);
  }, [id, end, may, seen]);

  const ready = kept && parts && kept.log.loaded ? { parts, kept } : undefined;
  return { on, ready, sessions, states, reads: on ? reads : undefined, version };
}

/** The log paged back till it holds what was said by time (0: all of it): so the record's first
 *  page and the log's begin together, no gap of the others' words at the top. Whether any came. */
export async function alignBack(log: ChannelLog, time: number): Promise<boolean> {
  let any = false;
  for (let i = 0; i < 20 && log.more && (log.msgs[0]?.time ?? 0) > time; i++) {
    if (!(await log.older())) break;
    any = true;
  }
  return any;
}
