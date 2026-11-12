// 群聊配置 (docs/channels.md; the user, 2026-11-12): who is in a channel, in two parts. Agent: a
// row each, its logo, its nick (changed in place), what it runs as, what it receives (@我 or 全部),
// out (never the session the channel is); 添加 Agent at the end: a harness, then its model, effort
// and nick in place; the same harness as often as wanted. 人: 全部, or the apps and their logins
// to tick (an app's own tick is all of its logins), the one looking always in. One who is not of
// its people sees it all and changes nothing.
import { useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, Plus, X } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { Agent } from "../../api/types.gen";
import { MainKey, SecondKey } from "../../card";
import { Choose } from "../../choose";
import { api } from "../../api/client";
import { agentsQ, useApps } from "../../data";
import { t, useLang } from "../../i18n";
import { AGENTS, agentName, Avatar, cn, Logo, Switch, Tip } from "../../ui";
import { levelName } from "../effort";
import { memberError, type Ctl, type Line } from "./key";
import { validNick } from "./lib";
import { appAll, EVERYONE, everyone, hasApp, hasLogin, loginOf, onlyMe, setApp, setLogin } from "./setup";

const FIELD = "no-ring h-8 w-full min-w-0 rounded-md bg-fill px-2.5 text-base placeholder:text-ink-3 pointer-coarse:h-10";
const DEFAULT = "";

export function Config({ ctl }: { ctl: Ctl }) {
  useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** One change: its failure said under the part it is in. */
  const run = async (f: () => Promise<void> | void): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await f();
      return true;
    } catch (e) {
      setError(memberError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const off = busy || ctl.readOnly;
  return (
    <div className="no-bar flex min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{t("channel.config")}</span>
        {busy ? <LoaderCircle size={13} className="animate-spin text-ink-3" /> : ctl.readOnly && ctl.lines.length > 0 && <span className="text-xs text-ink-3">{t("channel.notJoined")}</span>}
      </div>
      <section aria-label={t("channel.agents")} className="flex flex-col gap-0.5">
        <Head>{t("channel.agents")}</Head>
        {ctl.lines.map((l) => (
          <AgentLine key={l.key} l={l} ctl={ctl} off={off} run={run} />
        ))}
        {!ctl.readOnly && <Add ctl={ctl} busy={busy} run={run} />}
      </section>
      <People ctl={ctl} off={off} run={run} />
      {error && <p className="m-0 px-1 text-xs text-err">{error}</p>}
    </div>
  );
}

const Head = ({ children }: { children: ReactNode }) => <div className="px-1 pb-0.5 text-xs text-ink-3">{children}</div>;

/** An agent's row. Its nick is changed in place: Enter or leaving it; one not allowed stays as typed, in red. */
function AgentLine({ l, ctl, off, run }: { l: Line; ctl: Ctl; off: boolean; run: (f: () => Promise<void> | void) => Promise<boolean> }) {
  const [nick, setNick] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const typed = nick ?? l.nick;
  const taken = typed !== "" && ctl.lines.some((x) => x.key !== l.key && x.nick.toLowerCase() === typed.toLowerCase());
  const bad = (typed !== "" && !validNick(typed)) || taken;
  const save = () => {
    if (nick === null || bad) return;
    // A chat's agent always has a nick; a draft's may be left for the server to make.
    if (nick === l.nick || (!nick && l.nick)) return setNick(null);
    void run(() => ctl.patch(l, { nick })).then((ok) => ok && setNick(null));
  };
  const all = l.recv === "all";
  return (
    <div className="flex h-9 items-center gap-2 rounded-md pl-1 pointer-coarse:h-11">
      <Logo agent={l.agent} size={16} />
      <input
        aria-label={t("channel.nick")}
        aria-invalid={bad || undefined}
        value={typed}
        placeholder={ctl.hint?.(l) ?? ""}
        maxLength={32}
        disabled={off}
        title={bad ? t(taken ? "channel.nickTaken" : "channel.nickBad") : undefined}
        onChange={(e) => setNick(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.preventDefault(), e.currentTarget.blur());
          else if (e.key === "Escape" && nick !== null) (e.stopPropagation(), setNick(null));
        }}
        className={cn("no-ring h-7 w-24 min-w-0 shrink-0 rounded-md bg-transparent px-1.5 text-base placeholder:text-ink-3 enabled:hover:bg-fill enabled:focus:bg-fill", bad && "text-err")}
      />
      <span className="min-w-0 flex-1 truncate text-xs text-ink-3" title={l.name}>
        {l.name}
      </span>
      <Tip label={t("channel.recv")}>
        <button type="button" disabled={off} aria-label={`${t("channel.recv")}: ${t(all ? "channel.recvAll" : "channel.recvAt")}`} onClick={() => void run(() => ctl.patch(l, { recv: all ? "at" : "all" }))} className="g-press h-6 shrink-0 rounded-full bg-fill px-2 text-xs text-ink-2 enabled:hover:bg-fill-2 enabled:hover:text-ink disabled:opacity-60">
          {t(all ? "channel.recvAll" : "channel.recvAt")}
        </button>
      </Tip>
      {!ctl.readOnly &&
        (l.own ? (
          <span aria-hidden className="size-7 shrink-0" />
        ) : sure ? (
          <button type="button" autoFocus disabled={off} onBlur={() => setSure(false)} onClick={() => void run(() => ctl.remove(l))} className="g-press h-6 shrink-0 rounded-full bg-fill px-2 text-xs text-err hover:bg-fill-2">
            {t("channel.remove")}
          </button>
        ) : (
          <Tip label={t("channel.remove")}>
            <button type="button" disabled={off} aria-label={`${t("channel.remove")} ${l.nick}`} onClick={() => (ctl.confirm ? setSure(true) : void run(() => ctl.remove(l)))} className="g-press grid size-7 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-fill hover:text-ink disabled:opacity-40">
              <X size={14} />
            </button>
          </Tip>
        ))}
    </div>
  );
}

/** 添加 Agent: a harness, then what it runs with and its nick, in place. */
function Add({ ctl, busy, run }: { ctl: Ctl; busy: boolean; run: (f: () => Promise<void> | void) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const info = useQuery({ ...agentsQ, enabled: open }).data;
  const kinds: Agent[] = ctl.kinds ?? info?.map((x) => x.agent) ?? AGENTS;
  const missing = (k: Agent) => !ctl.kinds && !!info?.find((x) => x.agent === k)?.missing;
  const [agent, setAgent] = useState<Agent | null>(null);
  const [model, setModel] = useState(DEFAULT);
  const [effort, setEffort] = useState(DEFAULT);
  const [nick, setNick] = useState("");
  // What the kind may start with: as a peer of it in the channel says, else as its latest
  // session where this one would run did (GET …/choices).
  const known = agent ? ctl.options(agent) : { models: [], levels: [] };
  const asked = useQuery({ queryKey: ["agent-choices", agent, ctl.at?.channel ?? "", ctl.at?.machine ?? ""], queryFn: () => api.agentChoices(agent!, ctl.at ?? {}), enabled: !!agent && !!ctl.at && !known.models.length, staleTime: 60_000 }).data;
  const opts = known.models.length || !asked ? known : { models: asked.models.filter((m) => m.value !== "default").map((m) => ({ value: m.value, name: m.name })), levels: asked.efforts };
  const taken = nick !== "" && ctl.lines.some((x) => x.nick.toLowerCase() === nick.toLowerCase());
  const bad = (nick !== "" && !validNick(nick)) || taken;
  const shut = () => (setOpen(false), setAgent(null), setModel(DEFAULT), setEffort(DEFAULT), setNick(""));
  const add = () => agent && !bad && void run(() => ctl.add({ agent, recv: "at", ...(model.trim() ? { model: model.trim() } : {}), ...(effort ? { effort } : {}), ...(nick ? { nick } : {}) })).then((ok) => ok && shut());
  const row = (label: string, field: ReactNode) => (
    <label className="flex h-9 items-center justify-between gap-3 pl-1 text-sm pointer-coarse:h-11">
      <span className="shrink-0 text-ink-2">{label}</span>
      {field}
    </label>
  );
  if (!open)
    return (
      <button type="button" disabled={busy} onClick={() => setOpen(true)} className="g-press flex h-9 items-center gap-2 rounded-md pl-1 text-left text-base text-ink-2 hover:bg-fill hover:text-ink disabled:opacity-50 pointer-coarse:h-11">
        <span className="grid size-4 place-items-center">
          <Plus size={15} />
        </span>
        {t("channel.add")}
      </button>
    );
  return (
    <form
      className="g-fade mt-1 flex flex-col gap-1 rounded-lg p-1.5 shadow-[inset_0_0_0_0.5px_var(--edge)]"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <div role="radiogroup" aria-label={t("new.agent")} className="g-stagger grid grid-cols-4 gap-1">
        {kinds.map((k, i) => (
          <Tip key={k} label={missing(k) ? t("new.notInstalled", { name: agentName(k) }) : agentName(k)}>
            <button type="button" role="radio" aria-checked={agent === k} aria-label={agentName(k)} disabled={busy || missing(k)} onClick={() => (setAgent(k), setModel(DEFAULT), setEffort(DEFAULT))} style={{ "--i": i } as CSSProperties} className={cn("g-press grid h-12 place-items-center rounded-md hover:bg-fill disabled:opacity-40", agent === k && "bg-fill shadow-[inset_0_0_0_1px_var(--edge)]")}>
              <Logo agent={k} size={22} />
            </button>
          </Tip>
        ))}
      </div>
      {agent && (
        <>
          {row(
            t("composer.model"),
            opts.models.length ? (
              <Choose label={t("composer.model")} value={model} onChange={setModel} options={[{ value: DEFAULT, label: t("channel.default") }, ...opts.models.map((m) => ({ value: m.value, label: m.name }))]} />
            ) : (
              <input aria-label={t("composer.model")} placeholder={t("channel.default")} value={model} onChange={(e) => setModel(e.target.value)} className={cn(FIELD, "h-7 w-44 text-sm pointer-coarse:h-9")} />
            ),
          )}
          {opts.levels.length > 1 && row(t("channel.effort"), <Choose label={t("channel.effort")} value={effort} onChange={setEffort} options={[{ value: DEFAULT, label: t("channel.default") }, ...opts.levels.map((l) => ({ value: l, label: levelName(l) }))]} />)}
          <input aria-label={t("channel.nick")} aria-invalid={bad || undefined} placeholder={t("channel.nickAuto")} value={nick} maxLength={32} onChange={(e) => setNick(e.target.value)} className={cn(FIELD, bad && "text-err")} />
          {bad && <p className="m-0 px-1 text-xs text-err">{t(taken ? "channel.nickTaken" : "channel.nickBad")}</p>}
        </>
      )}
      <div className="mt-0.5 flex justify-end gap-1.5">
        <SecondKey onClick={shut}>{t("me.cancel")}</SecondKey>
        <MainKey type="submit" busy={busy} disabled={!agent || bad}>
          {t("channel.addKey")}
        </MainKey>
      </div>
    </form>
  );
}

/** A tick: role checkbox, ink when on; locked, faint. */
function Tick({ on, locked, label, onChange }: { on: boolean; locked?: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} disabled={locked} onClick={() => onChange(!on)} className={cn("g-press grid size-[18px] shrink-0 place-items-center rounded-[5px] transition-colors duration-(--dur-1)", on ? "bg-ink text-on-ink" : "shadow-[inset_0_0_0_1.5px_var(--ink-4)]", locked && "opacity-40")}>
      {on && <Check size={12} strokeWidth={3} className="g-pop" />}
    </button>
  );
}

/** 人: everyone, or those ticked. The host is always in and is not listed. */
function People({ ctl, off, run }: { ctl: Ctl; off: boolean; run: (f: () => Promise<void> | void) => Promise<boolean> }) {
  const d = useApps().data;
  const all = everyone(ctl.people);
  const apps = (d?.apps ?? []).filter((a) => !a.host);
  const loginsOf = (app: string) => (d?.logins ?? []).filter((l) => l.app === app);
  const set = (p: string[]) => void run(() => ctl.setPeople(p));
  const person = (key: string, face: ReactNode, name: string, on: boolean, locked: boolean, change: (on: boolean) => void, inner?: boolean) => (
    <label key={key} className={cn("flex h-8 items-center gap-2 rounded-md pr-1 text-base pointer-coarse:h-10", inner ? "pl-7" : "pl-1")}>
      {face}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <Tick on={on} locked={locked} label={name} onChange={change} />
    </label>
  );
  return (
    <section aria-label={t("channel.people")} className="flex flex-col gap-0.5">
      <Head>{t("channel.people")}</Head>
      <label className="flex h-9 items-center justify-between gap-3 pl-1 text-base pointer-coarse:h-11">
        {t("channel.everyone")}
        <Switch on={all} disabled={off} label={t("channel.everyone")} onChange={(on) => set(on ? [EVERYONE] : onlyMe(ctl.me))} />
      </label>
      {!all &&
        apps.map((a) => {
          const logins = loginsOf(a.id);
          const mine = !!ctl.me && ctl.me.startsWith(`${a.id}/`);
          return (
            <div key={a.id} className="g-fade flex flex-col">
              {person(a.id, <Avatar src={a.avatar} name={a.name} size={20} type={a.type} />, a.web ? t("term.panel") : a.name, hasApp(ctl.people, a.id), off || ctl.me === appAll(a.id), (on) => set(setApp(ctl.people, a.id, on, ctl.me)))}
              {logins.map((l) => {
                const it = loginOf(a.id, l.id);
                return person(it, <Avatar src={l.avatar} name={l.name} size={18} />, l.name, hasLogin(ctl.people, a.id, l.id), off || (mine && ctl.me === it), (on) => set(setLogin(ctl.people, a.id, l.id, on, logins.map((x) => x.id), ctl.me)), true);
              })}
            </div>
          );
        })}
    </section>
  );
}
