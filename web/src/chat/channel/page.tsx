// A channel of several agents (docs/channels.md), as a chat: under the title its agents (the
// member bar); the conversation is the channel's log, only what was said (people's words as
// bubbles, an agent's as Markdown under its logo, nick and what it runs as, Iridium's lines small
// and centred), the newest at the bottom, paged back as you scroll up; an agent's own record
// (its thinking, its tool calls) is its session's chat. Under it: each agent's queue and asks,
// under its nick; a composer whose @ calls an agent; the quota of each kind of agent.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { api } from "../../api/client";
import type { Block, SessionState as LiveSession, Session } from "../../api/types.gen";
import { stateAhead, type Sent } from "../../chats";
import { LOCAL_ME, useApps, useMe, useWhoList, useWorkspaces } from "../../data";
import { t, useLang } from "../../i18n";
import { pushIn } from "../../motion";
import { openChat } from "../../route";
import { PULL } from "../../sheet";
import { getCarried, onCarried, setCarried, useConfirms, useList, useQuota, useSession } from "../../store";
import { also, carries, events, opened, type SatoriEvent } from "../../stream";
import { errText } from "../../toast";
import { agentName, cn, lampOf, Logo } from "../../ui";
import { Asks } from "../asks";
import { placeDropped } from "../at";
import { Composer, type ComposerHandle } from "../composer";
import { Copyable } from "../copyable";
import { Waiting } from "../live";
import { modelView, QuotaBars } from "../meters";
import { Queue } from "../queue";
import { PLACE_DRAG, SESSION_DRAG, sourceOf, yours } from "../refs";
import { Assistant, Attached, Line, Pending, YouBubble } from "../said";
import { Stick, toEnd } from "../stick";
import { groupMessages, linkNicks, quotaKinds, stillWaiting, watchExtra, type AgentRow, type Did, type Group, type Msg, eventParts, personName, type EventWords } from "./lib";
import { channelLog } from "./log";
import { useMembers } from "./gate";
import { MembersKey, NotJoined, useChannelCtl } from "./key";
import { MemberBar } from "./members";
import { NickLink, Nicks, NickWords } from "./nick";

const WORKING = new Set(["running", "compacting", "starting"]);

let lastStackH = 120;

const ghostOf = (row: Session): LiveSession => ({ ...row, asks: [], tasks: [], denials: [], queue: [], end: 0, proc: -1 });

/** The states of these sessions, as carried; drawn again as any of them changes. */
function useStates(ids: string[]): (LiveSession | undefined)[] {
  const [, redraw] = useState(0);
  const key = ids.join(" ");
  useEffect(() => onCarried((k) => k.startsWith("session:") && ids.includes(k.slice(8)) && redraw((n) => n + 1)), [key]);
  return ids.map((id) => getCarried<LiveSession>(`session:${id}`));
}

/** bar: the chat's top bar (chat.tsx Bar), the member bar its children. record: an agent's own
 *  record asked for (the channel's own session's: shown in its place). */
export function ChannelPage({ id, sheet = 0, bar, record }: { id: string; sheet?: number; bar: (s: Session | undefined, under: ReactNode) => ReactNode; record: (session: string) => void }) {
  useLang();
  const list = useList();
  const row = list?.find((x) => x.id === id);
  const real = useSession(id);
  const ghost = useMemo(() => row && ghostOf(row), [row]);
  const s = real ?? ghost;
  const [entry] = useState(() => channelLog(id));
  const log = entry.log;
  const [, redraw] = useState(0);
  const changed = () => redraw((n) => n + 1);
  const me = useMe().data;
  const self = me ?? LOCAL_ME;
  const terminals = useWhoList();
  const workspaces = useWorkspaces().data;
  const confirms = useConfirms();

  // Its agents: who they are from the list (at once), what each runs as and receives from the
  // members, their lamps from their sessions' states.
  const sessions = (row?.agents ?? []).map((a) => a.session);
  const states = useStates(sessions);
  const sig = states.map((st) => `${st?.model ?? ""}:${st?.effort ?? ""}:${st?.effortNow ?? ""}`).join(" ");
  const members = useMembers(id, sig);
  const ctl = useChannelCtl(id, members);
  // Not of its people: read, not spoken in (docs/channels.md).
  const may = !ctl.readOnly || !members;
  const agents: AgentRow[] = (row?.agents ?? []).map((a, i) => {
    const m = members?.members.find((x) => x.session === a.session);
    const of = states[i] ?? list?.find((x) => x.id === a.session);
    const agent = of?.agent ?? m?.agent ?? a.agent ?? "claude";
    return { session: a.session, member: `agent:${a.session}`, agent, nick: m?.nick ?? a.nick ?? "", name: m?.name ?? agentName(agent), status: of ? lampOf(of) : (m?.status ?? "idle"), recv: m?.recv ?? "at" };
  });

  // The stream carries the other agents' states too, as far as it has room; the rest are asked
  // for as the list says they changed.
  const key = sessions.join(" ");
  useEffect(() => {
    also(watchExtra(id, sessions));
    for (const x of sessions) if (!getCarried(`session:${x}`)) void stateAhead(x);
    return () => also([]);
  }, [id, key]);
  const moved = sessions.map((x) => {
    const r = list?.find((y) => y.id === x);
    return `${r?.status}:${r?.updatedAt}`;
  });
  useEffect(() => {
    sessions.forEach((x) => {
      if (carries(`session:${x}`)) return;
      void api.session(x, { priority: "low" } as RequestInit).then(
        (st) => setCarried(`session:${x}`, st),
        () => {},
      );
    });
  }, [moved.join(" ")]);

  // The newest page, or what was kept; then each message as its event brings it. What the events
  // may have missed (the stream down a while) is read once it is back, and as an agent's turn moves.
  useEffect(() => {
    let live = true;
    const more = () => void log.newer().then(() => live && changed(), () => {});
    more();
    const hear = (e: SatoriEvent) => {
      if (e.type !== "message-created" || e.channel?.id !== id || !e.message) return;
      log.heard({ ...e.message, _data: { ...e._data, ...e.message._data } });
      changed();
    };
    events.add(hear);
    opened.add(more);
    return () => {
      live = false;
      events.delete(hear);
      opened.delete(more);
    };
  }, [id]);
  const turns = states.map((st) => `${st?.status}:${st?.end}`).join(" ");
  useEffect(() => {
    if (log.loaded) void log.newer().then(changed, () => {});
  }, [turns]);

  // What was sent from here, till the log has it.
  const sent = (entry.sent = entry.sent.filter((x) => stillWaiting(x, log.msgs)));
  const bubbles = useRef(new Map<string, HTMLDivElement>());
  const fly = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = fly.current && bubbles.current.get(fly.current);
    if (!el) return;
    fly.current = null;
    toEnd(scroller.current);
    pushIn(el);
  });
  const onSent = (x: Sent) => {
    x.from = log.end;
    entry.sent.push(x);
    fly.current = x.key;
    changed();
  };
  const retry = async (x: Sent) => {
    x.failed = undefined;
    changed();
    try {
      const r = await api.send(id, x.text, x.files.map((f) => f.ref), false, x.input);
      x.seq = r.seq;
    } catch (e) {
      x.failed = errText(e);
    }
    changed();
  };

  // The bottom stack's height pads the conversation's end.
  const stack = useRef<HTMLDivElement>(null);
  const [stackH, setStackH] = useState(lastStackH);
  useLayoutEffect(() => {
    const el = stack.current;
    if (!el) return;
    const measure = () => setStackH((lastStackH = el.offsetHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!s]);

  const composer = useRef<ComposerHandle>(null);
  useEffect(() => {
    const put = (e: Event) => {
      if (!composer.current) return;
      composer.current.put((e as CustomEvent<string>).detail);
      e.preventDefault();
    };
    addEventListener("ir:note", put);
    return () => removeEventListener("ir:note", put);
  }, []);
  const call = (nick: string) => composer.current?.insert(`@${nick}`);
  const nicks = useMemo(() => ({ agents, call }), [agents.map((a) => `${a.session}:${a.nick}:${a.name}:${a.status}:${a.agent}`).join(" ")]);

  const files = (e: DragEvent) => e.dataTransfer.types.includes("Files") && (e.preventDefault(), true);
  const session = (e: DragEvent) => e.dataTransfer.types.includes(SESSION_DRAG) && (e.preventDefault(), (e.dataTransfer.dropEffect = "copy"), true);
  const place = (e: DragEvent) => e.dataTransfer.types.includes(PLACE_DRAG) && (e.preventDefault(), (e.dataTransfer.dropEffect = "copy"), true);
  const drop = (e: DragEvent) => {
    if (files(e)) return composer.current?.attach([...e.dataTransfer.files]);
    if (place(e)) {
      const p = placeDropped(e.dataTransfer.getData(PLACE_DRAG));
      return p && composer.current?.name(p);
    }
    if (!session(e)) return;
    const to = list?.find((x) => x.id === e.dataTransfer.getData(SESSION_DRAG));
    if (to && to.id !== id) composer.current?.name(to.id);
  };

  const who = (m: Extract<Msg["author"], { kind: "person" }>) => {
    const src = sourceOf(m.name, m.id, self, terminals, list ?? [], workspaces ?? []);
    return src.kind === "you" ? src : yours({ id: m.id, name: m.name });
  };
  const groups = useMemo(() => groupMessages(log.msgs), [log.msgs]);
  const working = agents.filter((a) => WORKING.has(a.status));
  const asking = agents.some((_, i) => states[i]?.asks.length);
  const grew = `${log.end} ${sent.length} ${working.map((a) => a.session).join(" ")}`;
  const padTop = 104; // the bar's 48px, the members' 40px, a gap

  if (!s) return <div className="relative h-full">{bar(row, null)}</div>;
  return (
    <Nicks.Provider value={nicks}>
      <div className="relative h-full" data-chat-drop={id} onDragOver={(e) => files(e) || session(e) || place(e)} onDrop={drop}>
        <Stick scroller={scroller} tail={grew} older={() => log.older().then((any) => (changed(), any))} place={entry.place} bottom={stackH} quiet={asking} style={{ paddingTop: padTop, paddingBottom: stackH + 20 }}>
          <div className="mx-auto flex max-w-[760px] flex-col gap-5 px-4 sm:px-6">
            {groups.map((g) => (
              <GroupView key={g.key} g={g} channel={id} agents={agents} who={who} />
            ))}
            {sent.map((x) => (
              <Pending
                key={x.key}
                s={x}
                who={yours(self)}
                words={<NickWords text={x.text} />}
                bubbleRef={(el) => void (el ? bubbles.current.set(x.key, el) : bubbles.current.delete(x.key))}
                retry={() => retry(x)}
                drop={() => ((entry.sent = entry.sent.filter((y) => y !== x)), changed())}
              />
            ))}
            {/* Those at work, a line each: its logo, its nick, the dots. One line high even with
                none, so the conversation does not move as a turn begins or ends. */}
            {log.loaded && (
              <div className="-mt-2 flex min-h-7 flex-col pointer-coarse:min-h-9">
                {working.map((a) => (
                  <div key={a.session} className="g-fade flex h-7 items-center gap-1.5 text-xs text-ink-3 pointer-coarse:h-9" role="status" aria-label={`${a.nick} · ${t("chat.working")}`}>
                    <Logo agent={a.agent} size={14} />
                    <span className="mr-1 max-w-40 truncate">{a.nick}</span>
                    <Waiting on quiet={a.session} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Stick>
        {bar(s, <MemberBar channel={id} agents={agents} call={call} record={record} ctl={ctl} />)}
        <div ref={stack} {...{ [PULL]: "" }} data-covered={sheet > 0 || undefined} data-sunk={(sheet > 0 && stackH > sheet - 16) || undefined} inert={sheet > 0} className="g-turn-stay g-sink vt-stack absolute inset-x-0 bottom-0 z-10 px-2.5 pb-[max(10px,calc(env(safe-area-inset-bottom)+6px))] sm:px-5">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[calc(64px+max(10px,calc(env(safe-area-inset-bottom)+6px)))] bg-[linear-gradient(to_bottom,transparent,var(--paper)_14px)]" />
          <div className="relative mx-auto max-w-[760px]">
            {agents.map((a, i) => {
              const st = states[i];
              return st?.queue?.length ? (
                <Of key={a.session} a={a} off={!may}>
                  <Queue session={a.session} queue={st.queue} steered={() => {}} />
                </Of>
              ) : null;
            })}
            {agents.map((a, i) => {
              const st = states[i];
              const needs = confirms.filter((c) => c.session === a.session && c.kind !== "ask");
              return st?.asks.length || needs.length ? (
                <Of key={a.session} a={a} off={!may}>
                  <Asks session={a.session} asks={st?.asks ?? []} cwd={st?.cwd ?? s.cwd} confirms={needs} />
                </Of>
              ) : null;
            })}
            {!may ? <NotJoined ctl={ctl} /> : null}
            {may && <Composer ref={composer} s={s} turn={false} nicks={agents} lead={<MembersKey ctl={ctl} />} onSent={onSent} onSentDone={changed} cycleMode={() => {}} openModel={() => {}} openMode={() => {}} openUsage={() => {}} openContext={() => false} cleared={openChat} />}
            <Quotas agents={agents} states={states} />
          </div>
        </div>
      </div>
    </Nicks.Provider>
  );
}

/** Something of one agent's above the composer (its queue, its asks), under its logo and nick.
 *  off: shown, not to be answered (the one looking is not of the channel's people). */
function Of({ a, children, off }: { a: AgentRow; children: ReactNode; off?: boolean }) {
  return (
    <div inert={off} className={cn(off && "opacity-60")}>
      <div className="relative z-10 flex h-6 items-center gap-1.5 px-2 text-xs text-ink-2">
        <Logo agent={a.agent} size={12} />
        <span className="max-w-40 truncate">{a.nick}</span>
      </div>
      {children}
    </div>
  );
}

/** The quota of each kind of agent in the channel, one each (two agents on one login share it),
 *  as the one-agent composer shows its own; none for a kind that has none. */
function Quotas({ agents, states }: { agents: AgentRow[]; states: (LiveSession | undefined)[] }) {
  const quota = useQuota();
  const kinds = quotaKinds(agents.map((a, i) => ({ agent: a.agent, machine: states[i]?.machine, live: states[i]?.live, using: states[i] ? [states[i]!.model, states[i]!.pick, modelView(states[i]!).name] : [] })));
  const shown = kinds.filter((k) => quota?.agents.some((q) => q.agent === k.agent && (q.machine ?? "") === (k.machine ?? "") && (q.windows?.length || q.balance?.length)));
  if (!shown.length) return null;
  return (
    <div className="@container flex min-w-0 items-center gap-3 overflow-x-auto px-1.5 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {shown.map((k) => (
        <span key={`${k.agent}:${k.machine ?? ""}`} className="flex shrink-0 items-center">
          <Logo agent={k.agent} size={12} className="mr-0.5" />
          <QuotaBars agent={k.agent} machine={k.machine} live={k.live} using={k.using} />
        </span>
      ))}
    </div>
  );
}

/** A message as the block an agent's words are drawn from, the nicks it calls links: kept per
 *  message, so one drawn is not drawn again. */
const blocks = new WeakMap<Msg, { sig: string; b: Block }>();
function blockFor(m: Msg, nicks: string[]): Block {
  const sig = nicks.join(" ");
  const had = blocks.get(m);
  if (had?.sig === sig) return had.b;
  const b: Block = { at: String(m.n), kind: "assistant", text: linkNicks(m.text, nicks), ...(m.files.length ? { files: m.files } : {}), ...(m.time ? { time: m.time } : {}) };
  blocks.set(m, { sig, b });
  return b;
}

/** One speaker's messages: a person's bubble; an agent's words under its head; Iridium's line. */
function GroupView({ g, channel, agents, who }: { g: Group; channel: string; agents: AgentRow[]; who: (a: Extract<Msg["author"], { kind: "person" }>) => ReturnType<typeof yours> }) {
  const list = useList();
  const a = g.author;
  if (a.kind === "iridium")
    return (
      <div className="flex flex-col">
        {g.msgs.map((m) => (
          <EventLine key={m.n} m={m} />
        ))}
      </div>
    );
  if (a.kind === "person") {
    const m = g.msgs[0]!;
    return (
      <YouBubble text={m.text} who={who(a)} time={m.time} words={<NickWords text={m.text} />}>
        {m.files.map((f) => (
          <Attached key={f.ref} session={channel} f={f} />
        ))}
      </YouBubble>
    );
  }
  const now = agents.find((x) => x.session === a.session);
  const nicks = agents.map((x) => x.nick);
  // One no longer in the channel: its harness as the list still has its session.
  const agent = now?.agent ?? list?.find((x) => x.id === a.session)?.agent;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        {agent && <Logo agent={agent} size={16} />}
        <span className="shrink-0 text-sm font-medium">{now?.nick || a.nick}</span>
        <span className="min-w-0 truncate text-xs text-ink-3">{now?.name || a.name}</span>
      </div>
      {g.msgs.map((m) => (
        <div key={m.n} className={cn(m.kind === "error" && "text-err")}>
          {m.did && <DidLine did={m.did} />}
          <Copyable copy={m.text}>
            <Assistant b={blockFor(m, nicks)} session={a.session} />
          </Copyable>
        </div>
      ))}
    </div>
  );
}

const EVENT_KEYS = ["join", "leave", "rename", "recv", "everyone", "added", "removed", "undelivered", "stopped", "by", "sep"] as const;

/** A line of Iridium's own: what happened to the channel (who joined, left, was renamed, what one
 *  receives, its people), in the page's words, the agent in it as its nick is drawn elsewhere;
 *  one with no event (an older line), its own text. */
function EventLine({ m }: { m: Msg }) {
  useLang();
  const d = useApps().data;
  const words = { ...Object.fromEntries(EVENT_KEYS.map((k) => [k, t(`channel.event.${k}`)])), all: t("channel.recvAll"), at: t("channel.recvAt") } as EventWords;
  const parts = m.event && eventParts(m.event, words);
  if (!parts) return <Line title={m.text}>{m.text}</Line>;
  const apps = (d?.apps ?? []).map((a) => (a.web ? { ...a, name: t("term.panel") } : a));
  return (
    <Line title={m.text}>
      {parts.map((p, i) => (typeof p === "string" ? p : "nick" in p ? <NickLink key={i} nick={p.nick} /> : p.people.map((x) => personName(x, apps, d?.logins ?? [])).join(t("channel.event.sep"))))}
    </Line>
  );
}

/** What the agent did before the words under it, in one quiet line; the files it changed on hover. */
function DidLine({ did }: { did: Did }) {
  useLang();
  const parts: string[] = [];
  if (did.bash) parts.push(`bash ${did.bash}${did.cmds ? `（${did.cmds}）` : ""}${did.failed ? t("channel.did.failed", { n: did.failed }) : ""}`);
  if (did.files) parts.push(`${t("channel.did.files", { n: did.files })} +${did.add} −${did.del}`);
  if (did.read) parts.push(t("channel.did.read", { n: did.read }));
  if (did.web) parts.push(t("channel.did.web", { n: did.web }));
  if (did.agents) parts.push(t("channel.did.agents", { n: did.agents }));
  if (did.other) parts.push(t("channel.did.other", { n: did.other }));
  if (!parts.length) return null;
  const title = did.paths.map((f) => `${f.path}  +${f.add} −${f.del}`).join("\n");
  return (
    <div className="mb-1 truncate text-xs text-ink-3 tabular-nums" title={title || undefined}>
      {parts.join(" · ")}
    </div>
  );
}
