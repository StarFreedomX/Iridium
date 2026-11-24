// The scripts of a channel's IR (docs/channels.md "脚本"): a script's face, its card and its
// editor, one popover's pages (g-slide; back at the top left): the card (its face, name;
// who changed it last and from where, who made it; its triggers in words; its command line; 运行,
// 停用/启用, 编辑, 删除 asked again in place; what a run gave; its latest runs, sliding open); the
// editor (名称, 介绍, 头像, 命令, 触发), a new one from a template first (唤醒词, 定时提醒, 空白).
// Opened from a script's face beside what it said, and from the members' list (top.tsx).
import { Popover } from "@base-ui/react/popover";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CircleOff, CirclePlay, LoaderCircle, PencilLine, Play, Plus, SquareTerminal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { api, ApiError } from "../../api/client";
import type { Agent, NewScript, Script, ScriptBy, ScriptRun } from "../../api/types.gen";
import { FacePick } from "../../facepick";
import { isColour } from "../../facevalue";
import { t, useLang } from "../../i18n";
import { Segmented } from "../../me";
import { openChat } from "../../route";
import { useCarried, useList } from "../../store";
import { errText, toast } from "../../toast";
import { ago, cn, CopyKey, IconKey, isHost, PopSurface, titleOf, useMinute } from "../../ui";
import { Frame } from "./edit";
import { Face, MemberFace } from "./face";
import { mayAct, useMembers } from "./gate";
import { validNick } from "./lib";
import { CARD_POP, ProfileCard, type CardKey } from "./profilecard";
import { cronWords, triggerWords, useRecvName, useRecvOptions } from "./recv";
import { blankTrigger, cronReading, draftOf, EVENTS, scriptRefusal, toggle, triggerLine, triggerOf, type TriggerDraft, type TriggerKind } from "./scripts";

const scriptsKey = (channel: string) => ["scripts", channel];
const runsKey = (channel: string, name: string) => ["scriptRuns", channel, name];

/** A channel's scripts (GET …/scripts), asked again whenever any script changes or runs (the
 *  carried "scripts"). */
export function useScripts(channel: string): Script[] | undefined {
  const seq = useCarried<number>("scripts");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: scriptsKey(channel), queryFn: () => api.scripts(channel), staleTime: 5_000, retry: false, enabled: !!channel });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    void qc.invalidateQueries({ queryKey: scriptsKey(channel) });
    void qc.invalidateQueries({ queryKey: ["scriptRuns", channel] });
  }, [seq, channel, qc]);
  return q.data;
}

/** A channel's scripts asked for ahead (the members' key pointed at): its list and their cards
 *  open whole. */
export const prefetchScripts = (qc: QueryClient, channel: string) => void qc.prefetchQuery({ queryKey: scriptsKey(channel), queryFn: () => api.scripts(channel), staleTime: 5_000 });

/** A script's face (its avatar): an emoji on a soft disc, a colour's disc; none, a terminal. */
export function ScriptFace({ avatar, size }: { avatar?: string; size: number }) {
  const style = { width: size, height: size };
  if (avatar && isColour(avatar)) return <span className="block shrink-0 rounded-full shadow-[inset_0_0_0_0.5px_var(--edge)]" style={{ ...style, background: avatar }} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-fill-2 leading-none text-ink-2 select-none" style={{ ...style, fontSize: Math.round(size * 0.58) }}>
      {avatar || <SquareTerminal size={Math.round(size * 0.58)} strokeWidth={1.75} />}
    </span>
  );
}

/** "IR" by a script's name: what speaks is the channel's IR. */
export const IrTag = () => <span className="shrink-0 rounded-sm bg-fill-2 px-1 text-[10px] leading-4 font-semibold text-ink-3">IR</span>;

/** A script's state in a word: 已停用, 出错 (its last run did not end well); else none. */
export const scriptState = (x: Script) => (!x.enabled ? t("script.off") : x.last && x.last.code !== 0 ? t("script.failed") : "");

/** A page of the popover: a command's card, its editor, a new one's draft. */
export type ScriptPage = { k: "card"; name: string } | { k: "edit"; name: string } | { k: "new" } | { k: "draft"; x: NewScript };

/** The popover at anchor, open while page is (a press elsewhere or Esc: done). still: out of a
 *  face in a conversation, where it opened. */
export function ScriptPop({ channel, anchor, page, done, still, align }: { channel: string; anchor: RefObject<HTMLElement | null>; page: ScriptPage | null; done: () => void; still?: boolean; align?: "start" | "end" }) {
  // The last one stays drawn while it folds away.
  const last = useRef(page);
  if (page) last.current = page;
  const x = page ?? last.current;
  return (
    <Popover.Root open={!!page} onOpenChange={(o) => !o && done()}>
      <PopSurface anchor={anchor.current} still={still} align={align} className={CARD_POP}>
        {x && <ScriptPages key={JSON.stringify(x)} channel={channel} start={x} done={done} />}
      </PopSurface>
    </Popover.Root>
  );
}

/** A script's face beside what it said: pressed, its card. */
export function ScriptFaceKey({ channel, name }: { channel: string; name: string }) {
  const face = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const x = useScripts(channel)?.find((s) => s.name === name);
  return (
    <>
      <button ref={face} type="button" aria-label={name} disabled={!x} onClick={() => setOpen(!open)} className="g-press grid size-7 shrink-0 place-items-center rounded-full select-none">
        <ScriptFace avatar={x?.avatar} size={28} />
      </button>
      <ScriptPop channel={channel} anchor={face} page={open && x ? { k: "card", name } : null} done={() => setOpen(false)} still />
    </>
  );
}

/** The popover's pages, one after another: forward slides in from the right, back from the left. */
function ScriptPages({ channel, start, done }: { channel: string; start: ScriptPage; done: () => void }) {
  useLang();
  const [stack, setStack] = useState<ScriptPage[]>([start]);
  const [dir, setDir] = useState<"back" | undefined>();
  const page = stack.at(-1)!;
  const go = (p: ScriptPage) => (setDir(undefined), setStack([...stack, p]));
  const back = stack.length > 1 ? () => (setDir("back"), setStack(stack.slice(0, -1))) : undefined;
  // Saved: its card, nothing to go back to.
  const saved = (name: string) => (setDir(undefined), setStack([{ k: "card", name }]));
  const key = `${stack.length}`;
  switch (page.k) {
    case "card":
      return <Card key={key} channel={channel} name={page.name} dir={dir} back={back} edit={() => go({ k: "edit", name: page.name })} done={done} />;
    case "edit":
      return <Editor key={key} channel={channel} name={page.name} dir={dir} back={back} saved={saved} />;
    case "new":
      return <Editor key={key} channel={channel} draft={{ name: "", run: "", on: [{ message: {} }] }} dir={dir} back={back} saved={saved} />;
    case "draft":
      return <Editor key={key} channel={channel} draft={page.x} dir={dir} back={back} saved={saved} />;
  }
}

/** A refusal of the server's in the page's words. */
function why(e: unknown): string {
  if (e instanceof ApiError) {
    const k = scriptRefusal(e.status, e.message);
    if (k) return t(`script.why.${k}` as Parameters<typeof t>[0]);
  }
  return errText(e);
}

const HEAD = "m-0 mt-3.5 mb-1 flex h-5 items-center gap-2 text-xs font-medium text-ink-3";
const day = (ms: number, lang: string) => new Date(ms).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { year: "numeric", month: "short", day: "numeric" });
const clock = (ms: number, lang: string) => new Date(ms).toLocaleString(lang === "zh" ? "zh-CN" : "en", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const firstLine = (r: ScriptRun) => ((r.code === 0 ? r.out : r.err || r.out) ?? "").trim().split("\n")[0] ?? "";
/** Who made or changed it, by name: an agent "@nick", the host's login Iridium (docs/前端设计规范.md "称呼"). */
const byName = (by: ScriptBy) => (by.nick ? `@${by.nick}` : by.member && isHost(by.member) ? "Iridium" : by.name || "—");
const outcome = (r: ScriptRun) => (r.code === 0 ? t("script.ok") : r.code === -1 ? t("script.unfinished") : t("script.code", { code: r.code }));

/** What opens and shuts under something, its height gliding; the last of it drawn while it shuts. */
function Slide({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div inert={!open || undefined} aria-hidden={!open || undefined} className="g-reveal" data-open={open ? "" : undefined}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** A script's card. */
function Card({ channel, name, dir, back, edit, done }: { channel: string; name: string; dir?: "back"; back?: () => void; edit: () => void; done: () => void }) {
  const lang = useLang();
  const qc = useQueryClient();
  const x = useScripts(channel)?.find((s) => s.name === name);
  const may = mayAct(useMembers(channel));
  const nameOf = useRecvName(channel);
  // Its runs asked for as the card opens: there when 运行记录 is pressed.
  const runs = useQuery({ queryKey: runsKey(channel, name), queryFn: () => api.scriptRuns(channel, name), staleTime: 0, retry: false, enabled: !!x });
  const [ran, setRan] = useState<ScriptRun | null>(null);
  const [running, setRunning] = useState(false);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const id = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(id);
  }, [sure]);
  if (!x) return null;
  const put = (s: Script) => qc.setQueryData<Script[]>(scriptsKey(channel), (all) => all?.map((y) => (y.name === name ? s : y)));
  const run = () => {
    setRunning(true);
    void api
      .runScript(channel, name)
      .then(
        (r) => (setRan(r), void qc.invalidateQueries({ queryKey: runsKey(channel, name) })),
        (e) => toast(t("err.action"), { error: true, description: why(e) }),
      )
      .finally(() => setRunning(false));
  };
  const act = (f: () => Promise<unknown>) => () => {
    setBusy(true);
    void f()
      .catch((e) => toast(t("err.action"), { error: true, description: why(e) }))
      .finally(() => setBusy(false));
  };
  const keys: CardKey[] = [];
  if (may) {
    keys.push({ key: "run", icon: running ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} />, label: t("script.run"), run, disabled: running });
    keys.push({ key: "on", icon: x.enabled ? <CircleOff size={14} /> : <CirclePlay size={14} />, label: t(x.enabled ? "script.disable" : "script.enable"), run: act(() => api.patchScript(channel, name, { enabled: !x.enabled }).then(put)), disabled: busy });
    keys.push({ key: "edit", icon: <PencilLine size={14} />, label: t("script.change"), run: edit });
    // 删除 asked again in its own place (docs/前端设计规范.md "确认在原处").
    keys.push({
      key: "remove",
      icon: <Trash2 size={14} />,
      label: t(sure ? "script.removeSure" : "script.remove"),
      tone: sure ? "text-err" : undefined,
      disabled: busy,
      run: sure ? act(() => api.removeScript(channel, name).then(() => (qc.setQueryData<Script[]>(scriptsKey(channel), (all) => all?.filter((y) => y.name !== name)), done()))) : () => setSure(true),
    });
  }
  const w = triggerWords();
  const state = scriptState(x);
  return (
    <div data-dir={dir} className="g-slide no-bar relative max-h-[min(640px,var(--available-height))] overflow-y-auto">
      {back && (
        <IconKey label={t("nav.back")} onClick={back} tipSide="bottom" className="absolute top-1.5 left-1.5 z-10 size-7 bg-paper/70 pointer-coarse:size-9">
          <ChevronLeft size={16} />
        </IconKey>
      )}
      <ProfileCard
        face={<ScriptFace avatar={x.avatar} size={56} />}
        name={x.name}
        sub={<IrTag />}
        state={state && <span className={cn(x.enabled && "text-err")}>{state}</span>}
        keys={keys}
        more={
          <>
            <Changed channel={channel} by={x.changed} done={done} />
            <p className="m-0 mt-1 truncate text-xs leading-5 text-ink-3">{t("script.made", { name: byName(x.made), date: day(x.made.at, lang) })}</p>
            <h3 className={HEAD}>{t("script.triggers")}</h3>
            <ul className="m-0 flex list-none flex-col p-0">
              {x.on.map((tr, i) => (
                <li key={i} className="no-bar overflow-x-auto text-sm leading-6 whitespace-nowrap">
                  {triggerLine(tr, nameOf, w)}
                </li>
              ))}
            </ul>
            <h3 className={HEAD}>
              <span className="flex-1">{t("script.command")}</span>
              <CopyKey text={x.run} />
            </h3>
            <pre className="no-bar m-0 overflow-x-auto rounded-md bg-fill px-2.5 py-1.5 font-mono text-xs leading-5 whitespace-pre">{x.run}</pre>
          </>
        }
        after={
          <>
            <Slide open={!!ran}>{ran && <RunOut r={ran} />}</Slide>
            <button type="button" aria-expanded={list} onClick={() => setList(!list)} className="g-press mt-3 flex h-8 items-center gap-1 rounded-md text-sm text-ink-2 hover:text-ink pointer-coarse:h-10">
              <span className="flex-1 text-left">{t("script.runs")}</span>
              <ChevronRight size={14} className={cn("text-ink-4 transition-transform duration-(--dur-2)", list && "rotate-90")} />
            </button>
            <Slide open={list}>
              <Runs runs={runs.data} lang={lang} />
            </Slide>
          </>
        }
      />
    </div>
  );
}

/** Who changed it last: their face (an agent's, a person's), name, model and role; when; the
 *  session it was changed from (an agent's), pressed: that session. */
function Changed({ channel, by, done }: { channel: string; by: ScriptBy; done: () => void }) {
  useMinute();
  const list = useList();
  const members = useMembers(channel);
  const row = by.session ? list?.find((s) => s.id === by.session) : undefined;
  const kind = (row?.agent ?? members?.members.find((m) => m.session === by.session)?.agent ?? "") as Agent;
  const chip = (s?: string) => s && <span className="shrink-0 rounded-sm bg-fill px-1.5 text-xs leading-5 text-ink-2">{s}</span>;
  return (
    <>
      <h3 className={HEAD}>{t("script.changedBy")}</h3>
      <div className="no-bar flex h-7 items-center gap-2 overflow-x-auto whitespace-nowrap">
        {by.session ? (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-fill">
            <Face id={by.session} agent={kind} size={20} logo={12} />
          </span>
        ) : (
          <MemberFace member={by.member ?? ""} name={by.name} size={20} />
        )}
        <span className="shrink-0 text-sm">{byName(by)}</span>
        {chip(by.model)}
        {chip(by.role)}
      </div>
      <div className="no-bar flex h-5 items-center gap-2 overflow-x-auto text-xs whitespace-nowrap text-ink-3">
        <span className="shrink-0">{ago(by.at)}</span>
        {by.session && (
          <button type="button" onClick={() => (done(), openChat(by.session!))} className="shrink-0 rounded-sm underline decoration-ink-4 underline-offset-2 hover:text-ink hover:decoration-ink-2">
            {t("script.via", { name: row ? titleOf(row) : by.session.slice(0, 8) })}
          </button>
        )}
      </div>
    </>
  );
}

/** What a run gave: how it ended, how long it took, what it printed and its errors (folded at a
 *  press). */
function RunOut({ r }: { r: ScriptRun }) {
  const [open, setOpen] = useState(true);
  const text = (label: string, s?: string) =>
    s?.trim() && (
      <div className="mt-1.5">
        <div className="text-xs text-ink-3">{label}</div>
        <pre className="no-bar m-0 mt-0.5 max-h-40 overflow-auto rounded-md bg-fill px-2.5 py-1.5 font-mono text-xs leading-5 break-words whitespace-pre-wrap">{s}</pre>
      </div>
    );
  return (
    <div className="pt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-6 w-full items-center gap-2 rounded-sm text-sm">
        <span className={cn("shrink-0", r.code !== 0 && "text-err")}>{outcome(r)}</span>
        <span className="flex-1 text-left text-xs text-ink-3 tabular-nums">{r.ms} ms</span>
        {(r.out?.trim() || r.err?.trim()) && <ChevronRight size={14} className={cn("text-ink-4 transition-transform duration-(--dur-2)", open && "rotate-90")} />}
      </button>
      <Slide open={open}>
        {text(t("script.out"), r.out)}
        {text(t("script.err"), r.err)}
      </Slide>
    </div>
  );
}

/** Its latest runs, a line each: when, what ran it, how it ended, the first line it printed. */
function Runs({ runs, lang }: { runs?: ScriptRun[]; lang: string }) {
  if (runs && !runs.length) return <p className="m-0 py-2 text-sm text-ink-3">{t("script.runsNone")}</p>;
  return (
    <ul className="m-0 flex list-none flex-col p-0 pb-1">
      {(runs ?? []).slice(0, 20).map((r) => (
        <li key={r.id} className="no-bar flex h-7 items-center gap-2.5 overflow-x-auto text-xs whitespace-nowrap pointer-coarse:h-9">
          <span className="shrink-0 text-ink-3 tabular-nums">{clock(r.at, lang)}</span>
          <span className="shrink-0 text-ink-2">{t(`script.by.${r.trigger}` as Parameters<typeof t>[0]) || r.trigger}</span>
          <span className={cn("shrink-0", r.code !== 0 && "text-err")}>{outcome(r)}</span>
          {r.said ? <span className="shrink-0 text-ink-3 tabular-nums">#{r.said}</span> : null}
          <span className="font-mono text-ink-2">{firstLine(r)}</span>
        </li>
      ))}
    </ul>
  );
}

const INPUT = "no-ring w-full min-w-0 rounded-md bg-fill px-2.5 text-base placeholder:text-ink-3";
const LABEL = "flex flex-col gap-1.5 py-1.5 text-sm";

/** A chip that is pressed in or out (an agent called, a sender, an event). */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("g-press flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2.5 text-sm pointer-coarse:h-9", on ? "bg-ink text-on-ink" : "bg-fill text-ink-2 hover:bg-fill-2")}>
      {children}
    </button>
  );
}

/** 编辑脚本, 新建脚本: its fields and triggers, saved together; what the server refused under them. */
function Editor({ channel, name, draft, dir, back, saved }: { channel: string; name?: string; draft?: NewScript; dir?: "back"; back?: () => void; saved: (name: string) => void }) {
  const qc = useQueryClient();
  const was = useScripts(channel)?.find((s) => s.name === name);
  const from = was ?? draft;
  const [nm, setName] = useState(from?.name ?? "");
  const [avatar, setAvatar] = useState(from?.avatar ?? "");
  const [run, setRun] = useState(from?.run ?? "");
  const [on, setOn] = useState<TriggerDraft[]>(() => (from?.on.length ? from.on.map(draftOf) : [blankTrigger()]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = validNick(nm) && !!run.trim() && on.length > 0;
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError("");
    const x = { name: nm, avatar, run, on: on.map(triggerOf) };
    try {
      const s = name ? await api.patchScript(channel, name, x) : await api.addScript(channel, x);
      qc.setQueryData<Script[]>(scriptsKey(channel), (all) => [...(all ?? []).filter((y) => y.name !== name && y.name !== s.name), s]);
      void qc.invalidateQueries({ queryKey: scriptsKey(channel) });
      saved(s.name);
    } catch (e) {
      setError(why(e));
    } finally {
      setBusy(false);
    }
  };
  const setAt = (i: number, d: Partial<TriggerDraft>) => (setOn(on.map((x, j) => (j === i ? { ...x, ...d } : x))), setError(""));
  return (
    <Frame title={t(name ? "script.edit" : "script.new")} back={back} dir={dir}>
      <label className={LABEL}>
        {t("script.name")}
        <input value={nm} maxLength={32} onChange={(e) => (setName(e.target.value), setError(""))} aria-invalid={(!!nm && !validNick(nm)) || undefined} className={cn(INPUT, "h-8 pointer-coarse:h-10", nm && !validNick(nm) && "text-err")} />
      </label>
      <FacePick label={t("script.avatar")} preview={<ScriptFace avatar={avatar} size={28} />} set={async (v) => setAvatar(v)} still />
      <label className={LABEL}>
        {t("script.command")}
        <textarea value={run} rows={2} spellCheck={false} onChange={(e) => (setRun(e.target.value), setError(""))} className={cn(INPUT, "field-sizing-content max-h-40 min-h-[3.25rem] resize-none py-1.5 font-mono text-sm leading-5")} />
      </label>
      <div className="flex h-8 items-center gap-2 pt-1.5 text-sm">
        <span className="flex-1">{t("script.triggers")}</span>
        <IconKey label={t("script.addTrigger")} onClick={() => setOn([...on, blankTrigger()])} className="size-7">
          <Plus size={15} />
        </IconKey>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 pt-1">
        {on.map((d, i) => (
          <li key={i} className="g-fade rounded-md bg-fill p-2">
            <TriggerEdit channel={channel} d={d} set={(p) => setAt(i, p)} remove={on.length > 1 ? () => setOn(on.filter((_, j) => j !== i)) : undefined} />
          </li>
        ))}
      </ul>
      <Slide open={!!error}>
        <p className="m-0 pt-2 text-xs text-err">{error}</p>
      </Slide>
      <div className="mt-3 flex justify-end">
        <button type="button" disabled={!ok || busy} onClick={() => void save()} className="g-press flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-medium text-on-ink disabled:opacity-40 pointer-coarse:h-10">
          {busy && <LoaderCircle size={13} className="animate-spin" />}
          {t("script.save")}
        </button>
      </div>
    </Frame>
  );
}

/** One trigger: its kind, and that kind's fields. */
function TriggerEdit({ channel, d, set, remove }: { channel: string; d: TriggerDraft; set: (p: Partial<TriggerDraft>) => void; remove?: () => void }) {
  const kinds: TriggerKind[] = ["message", "command", "cron", "event"];
  const reading = d.kind === "cron" ? cronReading(d.cron, cronWords()) : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Segmented label={t("script.kind")} value={d.kind} onChange={(v) => set({ kind: v as TriggerKind })} items={kinds.map((k) => ({ v: k, label: t(`script.by.${k}`), icon: <span className="px-1 text-sm">{t(`script.by.${k}`)}</span> }))} />
        <span className="flex-1" />
        {remove && (
          <IconKey label={t("script.removeTrigger")} onClick={remove} className="size-7">
            <Trash2 size={14} />
          </IconKey>
        )}
      </div>
      {d.kind === "message" && (
        <>
          <Senders channel={channel} from={d.from} set={(from) => set({ from })} />
          <label className={LABEL}>
            {t("script.words")}
            <input value={d.words} placeholder={t("script.wordsHint")} onChange={(e) => set({ words: e.target.value })} className={cn(INPUT, "h-8 bg-paper pointer-coarse:h-10")} />
          </label>
        </>
      )}
      {d.kind === "command" && (
        <label className={LABEL}>
          {t("script.cmdName")}
          <span className="flex items-center gap-1">
            <span className="font-mono text-ink-3">/</span>
            <input value={d.command} spellCheck={false} onChange={(e) => set({ command: e.target.value.replace(/^\//, "") })} className={cn(INPUT, "h-8 bg-paper font-mono pointer-coarse:h-10")} />
          </span>
        </label>
      )}
      {d.kind === "cron" && (
        <label className={LABEL}>
          <span className="flex items-baseline gap-2">
            <span className="flex-1">{t("script.cron")}</span>
            <span className="truncate text-xs text-ink-3">{reading}</span>
          </span>
          <input value={d.cron} spellCheck={false} placeholder="m h dom mon dow" onChange={(e) => set({ cron: e.target.value })} className={cn(INPUT, "h-8 bg-paper font-mono pointer-coarse:h-10")} />
        </label>
      )}
      {d.kind === "event" && (
        <div className={LABEL}>
          {t("script.events")}
          <div className="flex flex-wrap gap-1.5">
            {EVENTS.map((e) => (
              <Chip key={e} on={d.event.includes(e)} onClick={() => set({ event: toggle(d.event, e) })}>
                {t(`on.ev.${e}`)}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Whose messages a message trigger takes: the entries a receive set may have; none, anyone. */
function Senders({ channel, from, set }: { channel: string; from: string[]; set: (f: string[]) => void }) {
  const options = useRecvOptions(channel);
  return (
    <div className={LABEL}>
      <span className="flex items-baseline gap-2">
        <span className="flex-1">{t("script.sender")}</span>
        {!from.length && <span className="text-xs text-ink-3">{t("script.anySender")}</span>}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Chip key={o.entry} on={from.includes(o.entry)} onClick={() => set(toggle(from, o.entry))}>
            {o.face}
            <span className="truncate">{o.label}</span>
          </Chip>
        ))}
      </div>
    </div>
  );
}
