// A channel's agents, in a row under the chat's title (docs/channels.md): each its harness's logo
// inside the ring of its context, its lamp on the corner, its nick beside it. A press calls it
// (@nick in the composer); the mouse resting on it shows what it runs as and its context's parts;
// the right button, or a finger held down, its menu: compact, model, effort, approval mode, stop,
// what it receives, its nick, its own record, what the channel gave it, out. After them a "+" adds
// another. The people in the channel are not shown here yet.
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Box, Brain, ChartPie, Check, ChevronRight, CircleStop, FoldVertical, PencilLine, Plus, Inbox, ScrollText, ShieldCheck, UserMinus, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { api, ApiError } from "../../api/client";
import type { Agent, ChannelMembers, SessionState as LiveSession, Session } from "../../api/types.gen";
import { CardFrame, CardHead, MainKey, SecondKey } from "../../card";
import { Choose } from "../../choose";
import { agentsQ } from "../../data";
import { t, useLang } from "../../i18n";
import { ModeMark, modeName } from "../../modes";
import { useContextState, useList, useSession } from "../../store";
import { errText, toast } from "../../toast";
import { AGENTS, agentName, cn, IconKey, Logo, LogoLamp, own, sessionStatusText, Tip, useLongPress, useMenuAt } from "../../ui";
import { levelName } from "../effort";
import { ContextDetail, modelView, useMode } from "../meters";
import { givenParts, validNick, type AgentRow } from "./lib";

const ITEM = "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-base outline-none select-none data-highlighted:bg-fill data-popup-open:bg-fill pointer-coarse:h-11";
const POPUP = "g-unfold glass thick float rounded-lg text-ink outline-none";
const BUSY = new Set(["running", "compacting", "starting", "waiting"]);

/** A member's state before the stream brings it, from its row. */
const ghostOf = (row: Session): LiveSession => ({ ...row, asks: [], tasks: [], denials: [], queue: [], end: 0, proc: -1 });

/** Why a change of the members was refused, in the page's words. */
export function memberError(e: unknown): string {
  if (e instanceof ApiError) {
    const code = (e.body as { code?: string } | undefined)?.code;
    if (e.status === 409 && code === "full") return t("channel.full");
    if (e.status === 403) return t("channel.forbidden");
    if (e.status === 400 && /nick/i.test(e.message)) return t("channel.nickTaken");
  }
  return errText(e);
}

/** Something that floats at a member's face: a popover's surface anchored there. */
function At({ anchor, open, onOpenChange, children, className, bare }: { anchor: RefObject<HTMLElement | null>; open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode; className?: string; bare?: boolean }) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} side="bottom" align="start" sideOffset={8} collisionPadding={8} className="z-50">
          <Popover.Popup initialFocus={(type) => type === "keyboard"} className={cn(bare ? "g-unfold outline-none" : POPUP, className)}>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The row of members. call: a nick pressed; record: a member's own record asked for. */
export function MemberBar({ channel, agents, call, record }: { channel: string; agents: AgentRow[]; call: (nick: string) => void; record: (session: string) => void }) {
  useLang();
  return (
    <div role="list" aria-label={t("channel.agents")} className="g-fade flex h-10 min-w-0 items-start gap-0.5 overflow-x-auto pr-2 pl-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {agents.map((a) => (
        <Member key={a.session} channel={channel} a={a} call={call} record={record} />
      ))}
      <AddAgent channel={channel} agents={agents} />
    </div>
  );
}

function Member({ channel, a, call, record }: { channel: string; a: AgentRow; call: (nick: string) => void; record: (session: string) => void }) {
  const real = useSession(a.session);
  const row = useList()?.find((x) => x.id === a.session);
  const s = real ?? (row && ghostOf(row));
  const ctx = useContextState(a.session) ?? s?.context;
  const face = useRef<HTMLButtonElement>(null);
  const [menuAt, setMenuAt] = useMenuAt();
  const [detail, setDetail] = useState(false);
  const [naming, setNaming] = useState(false);
  const [given, setGiven] = useState(false);
  const [sure, setSure] = useState(false);
  // The mouse resting on the face shows the detail; leaving it and the detail both puts it away.
  const rest = useRef<number | undefined>(undefined);
  const hover = (on: boolean, ms: number) => {
    clearTimeout(rest.current);
    rest.current = window.setTimeout(() => setDetail(on), ms);
  };
  useEffect(() => () => clearTimeout(rest.current), []);
  const lp = useLongPress(() => {
    const r = face.current?.getBoundingClientRect();
    setMenuAt(r ? { x: r.left, y: r.bottom + 4 } : { x: 40, y: 80 });
  });
  const pct = ctx?.max ? Math.min(100, Math.round((ctx.used / ctx.max) * 100)) : 0;
  const R = 13;
  const circ = 2 * Math.PI * R;
  const label = [a.nick, a.name, a.status !== "idle" && sessionStatusText(a)].filter(Boolean).join(" · ");
  return (
    <>
      <button
        ref={face}
        type="button"
        role="listitem"
        aria-label={label}
        onClick={() => (clearTimeout(rest.current), setDetail(false), call(a.nick))}
        {...lp}
        onPointerEnter={(e) => e.pointerType === "mouse" && hover(true, 350)}
        onPointerLeave={(e) => e.pointerType === "mouse" && hover(false, 150)}
        onContextMenu={(e) => {
          if (!own(e)) return;
          e.preventDefault();
          clearTimeout(rest.current);
          setDetail(false);
          setMenuAt({ x: e.clientX, y: e.clientY });
        }}
        className="g-press flex h-9 shrink-0 items-center gap-1.5 rounded-md pr-2 pl-1 select-none hover:bg-fill pointer-coarse:h-10 [-webkit-touch-callout:none]"
      >
        <span className="relative grid size-[30px] shrink-0 place-items-center">
          {/* The ring of its context, as the composer's (chat/meters.tsx ContextRing), around the logo. */}
          <svg width="30" height="30" viewBox="0 0 30 30" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="15" cy="15" r={R} fill="none" stroke="var(--fill-2)" strokeWidth="2" />
            {pct > 0 && <circle cx="15" cy="15" r={R} fill="none" stroke={pct >= 90 ? "var(--need)" : "var(--ink-2)"} strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(circ * pct) / 100} ${circ}`} />}
          </svg>
          <LogoLamp agent={a.agent} status={a.status} size={15} />
        </span>
        <span className="max-w-28 truncate text-xs text-ink-2">{a.nick}</span>
      </button>
      <At anchor={face} open={detail} onOpenChange={setDetail} className="w-[min(300px,calc(100vw-16px))] p-3.5">
        <div onPointerEnter={() => clearTimeout(rest.current)} onPointerLeave={(e) => e.pointerType === "mouse" && hover(false, 150)}>
          <div className={cn("flex items-baseline justify-between gap-3", !!ctx?.max && "mb-3")}>
            <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{a.name || agentName(a.agent)}</span>
            <span className="shrink-0 text-xs text-ink-3">{sessionStatusText(a)}</span>
          </div>
          {!!ctx?.max && <ContextDetail c={ctx} tokens={s?.tokens} />}
        </div>
      </At>
      {s && (
        <MemberMenu
          channel={channel}
          a={a}
          s={s}
          at={menuAt}
          close={() => setMenuAt(null)}
          detail={ctx?.max ? () => setDetail(true) : undefined}
          rename={() => setNaming(true)}
          record={() => record(a.session)}
          given={() => setGiven(true)}
          remove={a.session === channel ? undefined : () => setSure(true)}
        />
      )}
      <At anchor={face} open={naming} onOpenChange={setNaming} className="w-64 p-2.5">
        <NickForm channel={channel} a={a} done={() => setNaming(false)} />
      </At>
      <At anchor={face} open={sure} onOpenChange={setSure} bare className="w-[min(340px,calc(100vw-16px))]">
        <Remove channel={channel} a={a} done={() => setSure(false)} />
      </At>
      {given && <Given a={a} close={() => setGiven(false)} />}
    </>
  );
}

/** A submenu of a few to pick one of: its name, the one picked faint at the row's end. */
function Pick({ icon, label, now, value, options, set, i }: { icon: ReactNode; label: string; now?: string; value: string; options: { value: string; label: string; mark?: ReactNode; group?: string }[]; set: (v: string) => void; i: number }) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger style={{ "--i": i } as CSSProperties} className={ITEM}>
        <span className="text-ink-2">{icon}</span>
        <span className="flex-1">{label}</span>
        {now && <span className="max-w-28 truncate text-xs text-ink-3">{now}</span>}
        <ChevronRight size={14} className="text-ink-4" />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner className="z-50" sideOffset={4} collisionPadding={8}>
          <Menu.Popup className={cn(POPUP, "no-bar max-h-[min(480px,var(--available-height))] min-w-52 max-w-[calc(100vw-16px)] overflow-y-auto p-1.5")}>
            <Menu.RadioGroup value={value} onValueChange={(v) => set(v as string)} className="g-stagger flex flex-col">
              {options.map((o, j) => (
                <div key={o.value} className="contents">
                  {o.group && o.group !== options[j - 1]?.group && <div className="truncate px-2.5 pt-2 pb-0.5 text-xs text-ink-3 select-none first:pt-1">{o.group}</div>}
                  <Menu.RadioItem value={o.value} closeOnClick style={{ "--i": j } as CSSProperties} className="flex min-h-8 cursor-default items-center gap-2.5 rounded-md pr-2 pl-2.5 text-base outline-none select-none data-highlighted:bg-fill pointer-coarse:min-h-11">
                    {o.mark}
                    <span className="min-w-0 flex-1 truncate py-1">{o.label}</span>
                    <Menu.RadioItemIndicator className="text-ink">
                      <Check size={14} />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                </div>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

/** A member's menu, at a point. Its model, effort and mode are its session's own, set as the
 *  one-agent chat's keys set them. remove: none for the session the channel is. */
function MemberMenu({ channel, a, s, at, close, detail, rename, record, given, remove }: { channel: string; a: AgentRow; s: LiveSession; at: { x: number; y: number } | null; close: () => void; detail?: () => void; rename: () => void; record: () => void; given: () => void; remove?: () => void }) {
  const qc = useQueryClient();
  const mode = useMode(s);
  const v = modelView(s);
  const grouped = new Set(v.models.map((m) => m.group).filter(Boolean)).size > 1;
  const anchor = at && { getBoundingClientRect: () => DOMRect.fromRect({ x: at.x, y: at.y, width: 0, height: 0 }) };
  const act = (f: () => Promise<unknown>, err: string) => () => void f().catch((e) => toast(err, { error: true, description: errText(e) }));
  const recv = (r: string) =>
    r !== a.recv &&
    void api.patchMember(channel, a.member, { recv: r }).then(
      (ms) => qc.setQueryData<ChannelMembers>(["members", channel], ms),
      (e) => toast(t("err.action"), { error: true, description: memberError(e) }),
    );
  // Each after a frame: the menu shuts first, and what opens is not shut with it.
  const later = (f: () => void) => () => requestAnimationFrame(f);
  let i = 0;
  const item = (icon: ReactNode, label: string, run: () => void, tone?: string) => (
    <Menu.Item key={label} onClick={run} style={{ "--i": i++ } as CSSProperties} className={cn(ITEM, tone)}>
      <span className={tone ?? "text-ink-2"}>{icon}</span>
      {label}
    </Menu.Item>
  );
  return (
    <Menu.Root open={at !== null} onOpenChange={(o) => !o && close()}>
      <Menu.Portal>
        <Menu.Positioner anchor={anchor} side="bottom" align="start" sideOffset={4} collisionPadding={8} className="z-50">
          <Menu.Popup finalFocus={false} className={cn(POPUP, "min-w-52 p-1.5")}>
            <div className="g-stagger flex flex-col">
              {item(<FoldVertical size={15} />, t("channel.compact"), act(() => api.send(a.session, "/compact"), t("err.action")))}
              {v.models.length > 0 && (
                <Pick
                  icon={<Box size={15} />}
                  label={t("composer.model")}
                  now={v.name}
                  value={v.value}
                  options={v.models.map((m) => ({ value: m.value, label: m.name, ...(grouped && m.group ? { group: m.group } : {}) }))}
                  set={(m) => act(() => api.model(a.session, m), t("err.model"))()}
                  i={i++}
                />
              )}
              {v.levels.length > 1 && (
                <Pick icon={<Brain size={15} />} label={t("channel.effort")} now={v.level ? levelName(v.level) : undefined} value={v.level} options={v.levels.map((l) => ({ value: l, label: levelName(l) }))} set={(l) => act(() => api.effort(a.session, l), t("err.effort"))()} i={i++} />
              )}
              {mode.modes.length > 1 && (
                <Pick
                  icon={<ShieldCheck size={15} />}
                  label={t("composer.mode")}
                  now={modeName({ id: mode.now })}
                  value={mode.now}
                  options={mode.modes.map((m) => ({ value: m.id, label: modeName(m), mark: <ModeMark agent={mode.agent} id={m.id} size={16} className="shrink-0 text-ink-3" /> }))}
                  set={(m) => void mode.set(m)}
                  i={i++}
                />
              )}
              {BUSY.has(s.status) && item(<CircleStop size={15} />, t("channel.stop"), act(() => api.interrupt(a.session), t("err.stop")))}
              <Pick
                icon={<AtSign size={15} />}
                label={t("channel.recv")}
                now={t(a.recv === "all" ? "channel.recvAll" : "channel.recvAt")}
                value={a.recv}
                options={[
                  { value: "at", label: t("channel.recvAt") },
                  { value: "all", label: t("channel.recvAll") },
                ]}
                set={recv}
                i={i++}
              />
              {item(<PencilLine size={15} />, t("menu.rename"), later(rename))}
              {detail && item(<ChartPie size={15} />, t("ctx.title"), later(detail))}
              {item(<ScrollText size={15} />, t("channel.record"), record)}
              {item(<Inbox size={15} />, t("channel.given"), later(given))}
              {remove && item(<UserMinus size={15} />, t("channel.remove"), later(remove), "text-err")}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const FIELD = "no-ring h-8 w-full min-w-0 rounded-md bg-fill px-2.5 text-base placeholder:text-ink-3 pointer-coarse:h-10";

/** A member's nick, changed: letters, digits, _ and -, at most 32, no other member's. */
function NickForm({ channel, a, done }: { channel: string; a: AgentRow; done: () => void }) {
  const qc = useQueryClient();
  const [nick, setNick] = useState(a.nick);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bad = nick !== "" && !validNick(nick);
  const save = async () => {
    if (!nick || bad || busy) return;
    if (nick === a.nick) return done();
    setBusy(true);
    try {
      qc.setQueryData<ChannelMembers>(["members", channel], await api.patchMember(channel, a.member, { nick }));
      done();
    } catch (e) {
      setError(memberError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex items-center gap-1.5">
        <input autoFocus aria-label={t("channel.nick")} value={nick} maxLength={32} onFocus={(e) => e.currentTarget.select()} onChange={(e) => (setNick(e.target.value), setError(""))} className={FIELD} />
        <MainKey type="submit" busy={busy} disabled={!nick || bad}>
          {t("menu.rename")}
        </MainKey>
      </div>
      {(bad || error) && <p className="m-0 px-0.5 text-xs text-err">{bad ? t("channel.nickBad") : error}</p>}
    </form>
  );
}

/** A member taken out, asked first as the app asks before it deletes. */
function Remove({ channel, a, done }: { channel: string; a: AgentRow; done: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const out = async () => {
    setBusy(true);
    try {
      qc.setQueryData<ChannelMembers>(["members", channel], await api.removeMember(channel, a.member));
      done();
    } catch (e) {
      toast(t("err.action"), { error: true, description: memberError(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <CardFrame label={t("channel.removeTitle", { nick: a.nick })}>
      <CardHead
        icon={<UserMinus size={16} />}
        title={t("channel.removeTitle", { nick: a.nick })}
        summary={t("channel.removeHint")}
        keys={
          <>
            <SecondKey onClick={done}>{t("me.cancel")}</SecondKey>
            <MainKey busy={busy} onClick={() => void out()}>
              {t("channel.remove")}
            </MainKey>
          </>
        }
      />
    </CardFrame>
  );
}

const stamp = (ms: number, lang: string) => new Date(ms).toLocaleString(lang === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** What the channel gave an agent, the newest first: for each time, the message it was for, when,
 *  and its parts: where each is from, the values its slots took, the messages it cites. */
function Given({ a, close }: { a: AgentRow; close: () => void }) {
  const lang = useLang();
  const q = useQuery({ queryKey: ["injections", a.session], queryFn: () => api.injections(a.session), staleTime: 0, retry: false });
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-paper/70 backdrop-blur-sm transition-opacity duration-(--dur-2) data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className={cn(POPUP, "fixed top-1/2 left-1/2 z-50 flex max-h-[min(640px,86dvh)] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col")}>
          <div className="flex h-11 shrink-0 items-center gap-2 pr-1.5 pl-4">
            <Logo agent={a.agent} size={16} />
            <Dialog.Title className="m-0 min-w-0 flex-1 truncate text-sm font-semibold">
              {t("channel.given")} · {a.nick}
            </Dialog.Title>
            <Dialog.Close aria-label={t("msg.close")} className="g-press grid size-8 place-items-center rounded-md text-ink-2 hover:bg-fill hover:text-ink">
              <X size={15} />
            </Dialog.Close>
          </div>
          <div className="no-bar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {q.error ? <p className="m-0 py-6 text-center text-sm text-err">{errText(q.error)}</p> : q.data && !q.data.length ? <p className="m-0 py-6 text-center text-sm text-ink-3">{t("channel.givenNone")}</p> : null}
            <ol className="m-0 flex list-none flex-col gap-4 p-0">
              {q.data?.map((g) => (
                <li key={g.id} className="g-fade">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="font-semibold tabular-nums">{g.seq ? `#${g.seq}` : "—"}</span>
                    <span className="text-xs text-ink-3 tabular-nums">{stamp(g.at, lang)}</span>
                  </div>
                  <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
                    {givenParts(g.record).map((p, i) => (
                      <li key={i} className="rounded-md bg-fill px-2.5 py-1.5">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-mono text-xs break-all text-ink">{p.source}</span>
                          {p.refs.map((r) => (
                            <span key={r} className="text-xs text-ink-2 tabular-nums">
                              {r}
                            </span>
                          ))}
                        </div>
                        {p.values.map(([k, val]) => (
                          <div key={k} className="mt-0.5 flex gap-2 text-xs">
                            <span className="shrink-0 text-ink-3">{k}</span>
                            <span className="min-w-0 break-words whitespace-pre-wrap text-ink-2">{val}</span>
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const DEFAULT = "";

/** Adds an agent: its harness, as a new session offers them; its model and effort, those an agent
 *  of that harness in the channel says it takes, else the harness's own; a nick (one is made if
 *  none); what it receives. */
function AddAgent({ channel, agents }: { channel: string; agents: AgentRow[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const info = useQuery({ ...agentsQ, enabled: open }).data;
  const kinds: Agent[] = info?.map((x) => x.agent) ?? AGENTS;
  const missing = (k: Agent) => !!info?.find((x) => x.agent === k)?.missing;
  const [agent, setAgent] = useState<Agent>(agents[0]?.agent ?? "claude");
  const [model, setModel] = useState(DEFAULT);
  const [effort, setEffort] = useState(DEFAULT);
  const [nick, setNick] = useState("");
  const [recv, setRecv] = useState("at");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // What a harness takes, as one of its agents here says it.
  const like = agents.find((a) => a.agent === agent);
  const peer = useSession(like?.session ?? null);
  const v = peer ? modelView(peer) : undefined;
  const models = v?.models.filter((m) => m.value !== "default") ?? [];
  const levels = peer?.efforts ?? [];
  const bad = nick !== "" && !validNick(nick);
  const taken = !!nick && agents.some((a) => a.nick.toLowerCase() === nick.toLowerCase());
  const pick = (k: Agent) => (setAgent(k), setModel(DEFAULT), setEffort(DEFAULT), setError(""));
  const add = async () => {
    if (busy || bad || taken) return;
    setBusy(true);
    setError("");
    try {
      qc.setQueryData<ChannelMembers>(["members", channel], await api.addMember(channel, { agent, recv, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(nick ? { nick } : {}) }));
      setOpen(false);
      setNick("");
    } catch (e) {
      setError(memberError(e));
    } finally {
      setBusy(false);
    }
  };
  const row = (label: string, field: ReactNode) => (
    <label className="flex h-9 items-center justify-between gap-3 pl-1 text-sm pointer-coarse:h-11">
      <span className="shrink-0 text-ink-2">{label}</span>
      {field}
    </label>
  );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <IconKey label={t("channel.add")} tipSide="bottom" className="mt-0.5 size-8 text-ink-3 data-popup-open:bg-fill">
            <Plus size={16} />
          </IconKey>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8} collisionPadding={8} className="z-50">
          <Popover.Popup initialFocus={(type) => type === "keyboard"} className={cn(POPUP, "w-[min(300px,calc(100vw-16px))] p-2")}>
            <form
              className="flex flex-col gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <div role="radiogroup" aria-label={t("new.agent")} className="g-stagger grid grid-cols-4 gap-1">
                {kinds.map((k, i) => (
                  <Tip key={k} label={missing(k) ? t("new.notInstalled", { name: agentName(k) }) : agentName(k)}>
                    <button type="button" role="radio" aria-checked={agent === k} aria-label={agentName(k)} disabled={busy || missing(k)} onClick={() => pick(k)} style={{ "--i": i } as CSSProperties} className={cn("g-press grid h-14 place-items-center rounded-md hover:bg-fill disabled:opacity-40", agent === k && "bg-fill shadow-[inset_0_0_0_1px_var(--edge)]")}>
                      <Logo agent={k} size={24} />
                    </button>
                  </Tip>
                ))}
              </div>
              {models.length > 0 && row(t("composer.model"), <Choose label={t("composer.model")} value={model} onChange={setModel} options={[{ value: DEFAULT, label: t("channel.default") }, ...models.map((m) => ({ value: m.value, label: m.name }))]} />)}
              {levels.length > 1 && row(t("channel.effort"), <Choose label={t("channel.effort")} value={effort} onChange={setEffort} options={[{ value: DEFAULT, label: t("channel.default") }, ...levels.map((l) => ({ value: l, label: levelName(l) }))]} />)}
              {row(
                t("channel.recv"),
                <Choose
                  label={t("channel.recv")}
                  value={recv}
                  onChange={setRecv}
                  options={[
                    { value: "at", label: t("channel.recvAt") },
                    { value: "all", label: t("channel.recvAll") },
                  ]}
                />,
              )}
              <div className="mt-1 flex items-center gap-1.5">
                <input aria-label={t("channel.nick")} placeholder={t("channel.nickAuto")} value={nick} maxLength={32} onChange={(e) => (setNick(e.target.value), setError(""))} className={FIELD} />
                <MainKey type="submit" busy={busy} disabled={bad || taken} className="shrink-0">
                  {t("channel.addKey")}
                </MainKey>
              </div>
              {(bad || taken || error) && <p className="m-0 px-1 pt-0.5 text-xs text-err">{bad ? t("channel.nickBad") : taken ? t("channel.nickTaken") : error}</p>}
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
