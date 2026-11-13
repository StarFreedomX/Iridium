// A channel of several agents (docs/channels.md), as a chat: under the title its agents (the
// member bar); the conversation is the channel's log, only what was said (people's words as
// bubbles, an agent's as Markdown under its logo, nick and what it runs as, Iridium's lines small
// and centred), the newest at the bottom, paged back as you scroll up; an agent's own record
// (its thinking, its tool calls) is its session's chat. Under it: each agent's queue and asks,
// under its nick; a composer whose @ calls an agent; the quota of each kind of agent.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Reply } from "lucide-react";
import { api } from "../../api/client";
import type { Block, ChannelReads, Reader, SessionState as LiveSession, Session } from "../../api/types.gen";
import { stateAhead, type Sent } from "../../chats";
import { LOCAL_ME, useApps, useMe, useWhoList, useWorkspaces } from "../../data";
import { t, useLang } from "../../i18n";
import { pushIn } from "../../motion";
import { openChat } from "../../route";
import { PULL } from "../../sheet";
import { getCarried, onCarried, setCarried, useCarried, useConfirms, useList, useQuota, useSession } from "../../store";
import { also, carries, events, opened, type SatoriEvent } from "../../stream";
import { errText } from "../../toast";
import { agentName, Avatar, cn, lampOf, Logo, Tip } from "../../ui";
import { Asks } from "../asks";
import { placeDropped } from "../at";
import { Composer, type ComposerHandle } from "../composer";
import { Copyable } from "../copyable";
import { Waiting } from "../live";
import { modelView, QuotaBars } from "../meters";
import { Queue } from "../queue";
import { PLACE_DRAG, SESSION_DRAG, sourceOf, yours } from "../refs";
import { Assistant, Attached, Line, Pending, Said, YouBubble } from "../said";
import { folded } from "../fold";
import { Stick, toEnd } from "../stick";
import { groupMessages, readMarks, linkNicks, quotaKinds, stillWaiting, watchExtra, type AgentRow, type Did, type Group, type Msg, type Src, lineOf, workOf, eventParts, personName, type EventWords } from "./lib";
import { channelLog } from "./log";
import { useMembers } from "./gate";
import InviteLead from "./invite";
import { NotJoined, useChannelCtl } from "./key";
import { AgentFace } from "./members";
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

/** bar: the chat's top bar (chat.tsx Bar). The agents' quotas are at the composer's foot (the user, 2026-11-13). record: an agent's own
 *  record asked for (the channel's own session's: shown in its place). */
export function ChannelPage({ id, sheet = 0, bar, record }: { id: string; sheet?: number; bar: (s: Session | undefined) => ReactNode; record: (session: string) => void }) {
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
      const r = await api.send(id, x.text, x.files.map((f) => f.ref), false, x.input, x.quote);
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

  // Who said a person's words, and whether it is the one looking: only those are on the right
  // (the user, 2026-11-13); another login, an app, a Bot on the left, under its own face.
  const who = (m: Extract<Msg["author"], { kind: "person" }>) => {
    const src = sourceOf(m.name, m.id, self, terminals, list ?? [], workspaces ?? []);
    // The machine's own words (typed at its terminal, sent with its ir) are the host's.
    const mine = m.id === self.id || (!!self.host && (m.id === "local" || (src.kind === "you" && !!src.local)));
    if (src.kind === "you") return { who: src, mine };
    const known = terminals.find((x) => x.id === m.id);
    return { who: yours(known ? { ...known, name: m.name || known.name } : { id: m.id, name: m.name, device: "none" }), mine };
  };
  const groups = useMemo(() => groupMessages(log.msgs), [log.msgs]);
  // The message being answered (<quote>), over the composer till it is sent.
  const [quote, setQuote] = useState<Msg | null>(null);
  const nameOf = (m: Msg) => (m.author.kind === "agent" ? m.author.nick || m.author.name : m.author.kind === "person" ? m.author.name : "Iridium");
  const quoting = (m: Msg) => (setQuote(m), composer.current?.focus());
  const quoted = (n: number) => {
    const m = log.msgs.find((x) => x.n === n);
    return m ? { who: nameOf(m), text: m.text } : undefined;
  };

  // How far each member has read (docs/channels.md "已读"): asked once, then as the stream
  // brings it. This page has read what it shows: said as the log's end moves, while it is seen.
  const reads = useCarried<ChannelReads>(`reads:${id}`);
  useEffect(() => {
    void api.reads(id).then(
      (r) => getCarried(`reads:${id}`) || setCarried(`reads:${id}`, r),
      () => {},
    );
  }, [id]);
  const end = log.loaded ? log.end : 0;
  useEffect(() => {
    if (!end || !may || document.visibilityState !== "visible") return;
    const timer = setTimeout(() => void api.read(id, end).then((r) => setCarried(`reads:${id}`, r), () => {}), 600);
    return () => clearTimeout(timer);
  }, [id, end, may]);
  const marks = useMemo(() => readMarks(groups, reads?.readers ?? [], members?.me), [groups, reads, members?.me]);
  const working = agents.filter((a) => WORKING.has(a.status));
  const asking = agents.some((_, i) => states[i]?.asks.length);
  const grew = `${log.end} ${sent.length} ${working.map((a) => a.session).join(" ")}`;
  const padTop = 64; // the bar's 48px, a gap

  if (!s) return <div className="relative h-full">{bar(row)}</div>;
  return (
    <Nicks.Provider value={nicks}>
      <div className="relative h-full" data-chat-drop={id} onDragOver={(e) => files(e) || session(e) || place(e)} onDrop={drop}>
        <Stick scroller={scroller} tail={grew} older={() => log.older().then((any) => (changed(), any))} place={entry.place} bottom={stackH} quiet={asking} style={{ paddingTop: padTop, paddingBottom: stackH + 20 }}>
          <div className="mx-auto flex max-w-[760px] flex-col gap-5 px-4 sm:px-6">
            {groups.map((g) => (
              <div key={g.key} className="flex min-w-0 flex-col gap-1">
                <GroupView g={g} channel={id} agents={agents} who={who} record={record} call={call} may={may} quote={may ? quoting : undefined} quoted={quoted} />
                {marks.has(g.key) && <ReadMarks readers={marks.get(g.key)!} agents={agents} />}
              </div>
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
        {bar(s)}
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
            {may && <Composer ref={composer} s={s} turn={false} nicks={agents} lead={<InviteLead id={id} />} quote={quote ? { n: quote.n, who: nameOf(quote), text: quote.text } : undefined} unquote={() => setQuote(null)} tools={<Quotas agents={agents} states={states} />} onSent={onSent} onSentDone={changed} cycleMode={() => {}} openModel={() => {}} openMode={() => {}} openUsage={() => {}} openContext={() => false} cleared={openChat} />}
          </div>
        </div>
      </div>
    </Nicks.Provider>
  );
}

/** Who has read up to here: small faces at the right, under what they last read. */
function ReadMarks({ readers, agents }: { readers: Reader[]; agents: AgentRow[] }) {
  const names = readers.map((r) => r.nick || r.name || r.member).join(t("channel.event.sep"));
  return (
    <Tip label={t("channel.readBy", { names })}>
      <div role="group" aria-label={t("channel.readBy", { names })} className="g-fade flex h-4 items-center justify-end gap-0.5 self-end">
        {readers.slice(0, 8).map((r) => {
          const a = r.agent ?? agents.find((x) => x.member === r.member)?.agent;
          return a ? <Logo key={r.member} agent={a} size={12} className="opacity-70" /> : <Avatar key={r.member} name={r.name} size={14} />;
        })}
      </div>
    </Tip>
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
    <div className="@container flex min-w-0 items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
function GroupView({ g, channel, agents, who, record, call, may, quote, quoted }: { g: Group; channel: string; agents: AgentRow[]; who: (a: Extract<Msg["author"], { kind: "person" }>) => { who: ReturnType<typeof yours>; mine: boolean }; record: (session: string) => void; call: (nick: string) => void; may: boolean; quote?: (m: Msg) => void; quoted: (n: number) => { who: string; text: string } | undefined }) {
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
    const by = who(a);
    return (
      <Copyable copy={m.text} quote={quote && (() => quote(m))}>
        {m.quote !== undefined && <QuoteLine n={m.quote} q={quoted(m.quote)} right={by.mine} />}
        <YouBubble text={m.text} who={by.who} left={!by.mine} time={m.time} words={<NickWords text={m.text} />}>
          {m.files.map((f) => (
            <Attached key={f.ref} session={channel} f={f} />
          ))}
        </YouBubble>
      </Copyable>
    );
  }
  const now = agents.find((x) => x.session === a.session);
  const nicks = agents.map((x) => x.nick);
  // One no longer in the channel: its harness as the list still has its session.
  const agent = now?.agent ?? list?.find((x) => x.id === a.session)?.agent;
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      {now ? (
        <AgentFace channel={channel} a={now} call={call} record={record} may={may} />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fill">{agent && <Logo agent={agent} size={16} />}</span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex h-4 min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-xs font-medium text-ink-2">{now?.nick || a.nick}</span>
          <span className="min-w-0 truncate text-xs text-ink-4">{now?.name || a.name}</span>
        </div>
        {g.msgs.map((m) => (
          <div key={m.n} className={cn(m.kind === "error" && "text-err")}>
            {m.did && (m.src ? <Work src={m.src} did={m.did} /> : <DidLine did={m.did} />)}
            {m.quote !== undefined && <QuoteLine n={m.quote} q={quoted(m.quote)} />}
            <Copyable copy={m.text} quote={quote && (() => quote(m))}>
              <Assistant b={blockFor(m, nicks)} session={a.session} />
            </Copyable>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The message one answers, a quiet line over it: who said it, its first words. */
function QuoteLine({ n, q, right }: { n: number; q?: { who: string; text: string }; right?: boolean }) {
  return (
    <div className={cn("mb-1 flex min-w-0 items-center gap-1.5 text-xs text-ink-3", right && "justify-end")}>
      <Reply size={12} className="shrink-0" />
      <span className="shrink-0">#{n}</span>
      {q && <span className="shrink-0 font-medium text-ink-2">{q.who}</span>}
      {q && <span className="max-w-[60%] min-w-0 truncate">{q.text}</span>}
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

/** What the agent did before the words under it (the user, 2026-11-13: all of it, not a count):
 *  its thinking and tool calls from its own record, folded as its own chat folds them. The
 *  count's line until they come, or when the record cannot be read. */
function Work({ src, did }: { src: Src; did: Did }) {
  const row = useList()?.find((x) => x.id === src.session);
  const q = useQuery({
    queryKey: ["work", src.session, src.block ?? "", src.from ?? 0, src.to ?? 0],
    queryFn: async () => {
      const page = src.from !== undefined ? await api.messages(src.session, { after: Math.max(0, src.from - 1) }) : await api.messages(src.session, { before: lineOf(src.block!) + 1 });
      return workOf(page.blocks, src);
    },
    staleTime: Infinity,
    retry: false,
  });
  const work = q.data;
  if (!work?.length) return <DidLine did={did} />;
  return (
    <div className="mb-1.5 flex min-w-0 flex-col gap-3">
      {folded(work).map((b) => (
        <Said key={b.at} b={b} session={src.session} cwd={row?.cwd ?? ""} source={() => ({ kind: "you" }) as ReturnType<Parameters<typeof Said>[0]["source"]>} onJump={openChat} />
      ))}
    </div>
  );
}

/** What the agent did before the words under it, in one quiet line. */
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
  return (
    <div className="mb-1 truncate text-xs text-ink-3 tabular-nums">
      {parts.join(" · ")}
    </div>
  );
}
