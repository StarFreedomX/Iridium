// A channel's agents as faces (docs/channels.md): beside what each said, its harness's logo on a
// disc, its lamp on the corner. A press opens its card (as QQ's: talk to it in its own channel,
// call it here, its context); the right button, or a finger held down, its menu: compact, model, effort, approval mode, stop, what it receives, its nick, usage, its
// own session, what the channel gave it, out.
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, BarChart3, MessageCircle, Box, Brain, ChartPie, Check, ChevronRight, CircleStop, FoldVertical, ImagePlus, PencilLine, Inbox, ScrollText, ShieldCheck, UserMinus, X } from "lucide-react";
import { useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { api } from "../../api/client";
import type { ChannelMembers, SessionState as LiveSession, Session } from "../../api/types.gen";
import { CardFrame, CardHead, MainKey, SecondKey } from "../../card";
import { t, useLang } from "../../i18n";
import { ModeMark, modeName } from "../../modes";
import { useContextState, useList, useSession } from "../../store";
import { errText, toast } from "../../toast";
import { openChat, openUsage } from "../../route";
import { agentName, cn, Lamp, Logo, own, sessionStatusText, useLongPress, useMenuAt } from "../../ui";
import { levelName } from "../effort";
import { ContextDetail, modelView, useMode } from "../meters";
import { Face, pickFace } from "./face";
import { memberError } from "./key";
import { givenParts, validNick, type AgentRow } from "./lib";

const ITEM = "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-base outline-none select-none data-highlighted:bg-fill data-popup-open:bg-fill pointer-coarse:h-11";
const POPUP = "g-unfold glass thick float rounded-lg text-ink outline-none";
const BUSY = new Set(["running", "compacting", "starting", "waiting"]);

/** A member's state before the stream brings it, from its row. */
const ghostOf = (row: Session): LiveSession => ({ ...row, asks: [], tasks: [], denials: [], queue: [], end: 0, proc: -1 });

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

/** An agent's face beside what it said (the user, 2026-11-13): its harness's logo on a disc, its
 *  lamp on the corner. A press opens its card; the right button, or a finger held down, its menu. */
export function AgentFace({ channel, a, call, record, may, size = 28 }: { channel: string; a: AgentRow; call?: (nick: string) => void; record?: (session: string) => void; may: boolean; size?: number }) {
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
  const lp = useLongPress(() => {
    const r = face.current?.getBoundingClientRect();
    setMenuAt(r ? { x: r.left, y: r.bottom + 4 } : { x: 40, y: 80 });
  });
  const label = [a.nick, a.name, a.status !== "idle" && sessionStatusText(a)].filter(Boolean).join(" · ");
  return (
    <>
      <button
        ref={face}
        type="button"
        aria-label={label}
        onClick={() => setDetail(!detail)}
        {...lp}
        onContextMenu={(e) => {
          if (!own(e)) return;
          e.preventDefault();
          setDetail(false);
          setMenuAt({ x: e.clientX, y: e.clientY });
        }}
        style={{ width: size, height: size }}
        className="g-press grid shrink-0 place-items-center rounded-full bg-fill select-none hover:bg-fill-2 [-webkit-touch-callout:none]"
      >
        <span className="relative grid">
          <Face id={a.session} agent={a.agent} size={size} logo={Math.round(size * 0.57)} />
          {a.status !== "idle" && (
            <span className="absolute -right-0.5 -bottom-0.5">
              <Lamp status={a.status} />
            </span>
          )}
        </span>
      </button>
      <At anchor={face} open={detail} onOpenChange={setDetail} className="w-[min(300px,calc(100vw-16px))] p-3.5">
        <Card channel={channel} a={a} s={s} ctx={ctx} call={call} record={record} may={may} done={() => setDetail(false)} />
      </At>
      {s && (
        <MemberMenu
          channel={channel}
          a={a}
          s={s}
          may={may}
          at={menuAt}
          close={() => setMenuAt(null)}
          call={call}
          detail={ctx?.max ? () => setDetail(true) : undefined}
          rename={() => setNaming(true)}
          record={record && (() => record(a.session))}
          given={() => setGiven(true)}
          remove={a.session === channel || !may ? undefined : () => setSure(true)}
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

/** An agent's card (the user, 2026-11-13, as QQ's): its face, nick, what it runs as, its state
 *  and context; keys to talk to it in its own channel (its session: one channel bound to it),
 *  to call it here (@nick); in its own channel, to change its face and see its record. */
function Card({ channel, a, s, ctx, call, record, may, done }: { channel: string; a: AgentRow; s?: LiveSession; ctx?: Parameters<typeof ContextDetail>[0]["c"]; call?: (nick: string) => void; record?: (session: string) => void; may: boolean; done: () => void }) {
  const mine = a.session === channel;
  const key = "g-press flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-fill px-2 text-sm text-ink hover:bg-fill-2 pointer-coarse:h-10";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-fill">
          <Face id={a.session} agent={a.agent} size={48} logo={26} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold">{a.nick || agentName(a.agent)}</span>
          <span className="truncate text-xs text-ink-3">{a.name || agentName(a.agent)}</span>
          <span className="flex items-center gap-1.5 text-xs text-ink-3">
            <Lamp status={a.status} />
            {sessionStatusText(a)}
          </span>
        </div>
      </div>
      {!!ctx?.max && <ContextDetail c={ctx} tokens={s?.tokens} />}
      <div className="flex gap-1.5">
        {!mine && (
          <button type="button" onClick={() => (done(), openChat(a.session))} className={key}>
            <MessageCircle size={14} className="shrink-0" />
            <span className="truncate">{t("channel.talk")}</span>
          </button>
        )}
        {call && a.nick && (
          <button type="button" onClick={() => (done(), call(a.nick))} className={key}>
            <AtSign size={14} className="shrink-0" />
            <span className="truncate">{t("channel.call")}</span>
          </button>
        )}
        {mine && may && (
          <button type="button" onClick={() => (done(), requestAnimationFrame(() => pickFace(a.session)))} className={key}>
            <ImagePlus size={14} className="shrink-0" />
            <span className="truncate">{t("me.avatar")}</span>
          </button>
        )}
        {mine && record && (
          <button type="button" onClick={() => (done(), record(a.session))} className={key}>
            <ScrollText size={14} className="shrink-0" />
            <span className="truncate">{t("channel.session")}</span>
          </button>
        )}
      </div>
    </div>
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
/** may: the one looking is of the channel's people; else only what reads is offered. */
function MemberMenu({ channel, a, s, may, at, close, call, detail, rename, record, given, remove }: { channel: string; a: AgentRow; s: LiveSession; may: boolean; at: { x: number; y: number } | null; close: () => void; call?: (nick: string) => void; detail?: () => void; rename: () => void; record?: () => void; given: () => void; remove?: () => void }) {
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
              {call && a.nick && item(<AtSign size={15} />, t("channel.call"), later(() => call(a.nick)))}
              {may && item(<FoldVertical size={15} />, t("channel.compact"), act(() => api.send(a.session, "/compact"), t("err.action")))}
              {may && v.models.length > 0 && (
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
              {may && v.levels.length > 1 && (
                <Pick icon={<Brain size={15} />} label={t("channel.effort")} now={v.level ? levelName(v.level) : undefined} value={v.level} options={v.levels.map((l) => ({ value: l, label: levelName(l) }))} set={(l) => act(() => api.effort(a.session, l), t("err.effort"))()} i={i++} />
              )}
              {may && mode.modes.length > 1 && (
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
              {may && BUSY.has(s.status) && item(<CircleStop size={15} />, t("channel.stop"), act(() => api.interrupt(a.session), t("err.stop")))}
              {may && <Pick
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
              />}
              {may && item(<PencilLine size={15} />, t("menu.rename"), later(rename))}
              {detail && item(<ChartPie size={15} />, t("ctx.title"), later(detail))}
              {item(<BarChart3 size={15} />, t("usage.title"), later(() => openUsage(at ? { x: at.x, y: at.y } : undefined, s.machine)))}
              {may && item(<ImagePlus size={15} />, t("me.avatar"), later(() => pickFace(a.session)))}
              {record && item(<ScrollText size={15} />, t("channel.session"), record)}
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
