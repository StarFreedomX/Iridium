// A new session as the "+" makes it (create.tsx NewSession; the user, 2026-11-12), on one page,
// nothing opened beside it but an agent's own small popup: the agents in a row, one pressed lit
// and its popup out (model, effort, nick, all optional; shut, it is kept as set); the apps under
// them, a row each, their logins lit one by one or all at once, the one looking always lit; 完成
// makes it. The first agent lit is the session, those after it join it (NewSession.members).
import { Popover } from "@base-ui/react/popover";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { api } from "../../api/client";
import type { Agent, NewSession } from "../../api/types.gen";
import { MainKey } from "../../card";
import { Choose } from "../../choose";
import { useApps, useMe } from "../../data";
import { t, useLang } from "../../i18n";
import { MachineBadge, type Machine } from "../../machines";
import { agentName, Avatar, cn, Logo, PopSurface, Tip } from "../../ui";
import { levelName } from "../effort";
import { validNick } from "./lib";
import { appAll, draftNicks, EVERYONE, hasApp, hasLogin, loginOf, pressApp, pressLogin, setupOf } from "./setup";

/** What the session is made with beside its agent and folder. */
export type Extra = Pick<NewSession, "model" | "effort" | "members">;

/** An agent lit: what it starts with, "" its default. */
type Lit = { agent: Agent; model: string; effort: string; nick: string };

/** agents: the kinds shown (missing: one not installed, faded); m: the folder's machine, when it is
 *  another's. busy: a session being made. start: 完成, with the first agent lit. */
export default function NewChannel({ agents, missing, m, busy, start }: { agents: Agent[]; missing: (a: Agent) => boolean; m?: Machine; busy: boolean; start: (first: Agent, x: Extra) => void }) {
  useLang();
  const [lit, setLit] = useState<Lit[]>([]);
  const [people, setPeople] = useState<string[]>([EVERYONE]);
  const nicks = lit.length ? draftNicks({ first: { agent: lit[0]!.agent, nick: lit[0]!.nick, recv: "all" }, more: lit.slice(1), people }) : [];
  const patch = (a: Agent, p: Partial<Lit>) => setLit((x) => x.map((l) => (l.agent === a ? { ...l, ...p } : l)));
  const done = () => {
    const [first, ...more] = lit;
    if (!first || busy) return;
    const members = setupOf({ first: { agent: first.agent, nick: first.nick, recv: "all" }, more: more.map((l) => ({ agent: l.agent, recv: "at", ...(l.model ? { model: l.model } : {}), ...(l.effort ? { effort: l.effort } : {}), ...(l.nick ? { nick: l.nick } : {}) })), people });
    start(first.agent, { ...(first.model ? { model: first.model } : {}), ...(first.effort ? { effort: first.effort } : {}), ...(members ? { members } : {}) });
  };
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={t("new.agent")} className="g-stagger grid grid-cols-4 gap-1">
        {agents.map((a, i) => {
          const at = lit.findIndex((l) => l.agent === a);
          return (
            <AgentTile
              key={a}
              agent={a}
              i={i}
              m={m}
              off={busy || missing(a)}
              faded={missing(a) || (!!m && !m.online)}
              lit={at >= 0 ? lit[at]! : undefined}
              hint={at >= 0 ? (nicks[at] ?? "") : ""}
              taken={(n) => lit.some((l, j) => j !== at && (l.nick || nicks[j] || "").toLowerCase() === n.toLowerCase())}
              light={() => at < 0 && setLit((x) => [...x, { agent: a, model: "", effort: "", nick: "" }])}
              patch={(p) => patch(a, p)}
              drop={() => setLit((x) => x.filter((l) => l.agent !== a))}
            />
          );
        })}
      </div>
      <People people={people} setPeople={setPeople} />
      <div className="flex justify-end">
        <MainKey busy={busy} disabled={!lit.length} onClick={done}>
          {t("me.done")}
        </MainKey>
      </div>
    </div>
  );
}

/** A kind's tile: pressed, lit and its popup out; pressed lit, the popup again. */
function AgentTile({ agent, i, m, off, faded, lit, hint, taken, light, patch, drop }: { agent: Agent; i: number; m?: Machine; off: boolean; faded: boolean; lit?: Lit; hint: string; taken: (nick: string) => boolean; light: () => void; patch: (p: Partial<Lit>) => void; drop: () => void }) {
  const [open, setOpen] = useState(false);
  const label = tileLabel(agent, m, faded);
  const word = lit && (lit.nick || lit.model);
  return (
    <Popover.Root
      open={open && !!lit}
      onOpenChange={(o) => {
        if (o) light();
        // Shut with a nick not allowed: it is not kept.
        else if (lit && lit.nick && (!validNick(lit.nick) || taken(lit.nick))) patch({ nick: "" });
        setOpen(o);
      }}
    >
      <Tip label={label}>
        <Popover.Trigger
          render={
            <button type="button" aria-label={label} aria-pressed={!!lit} disabled={off} style={{ "--i": i } as CSSProperties} className={cn("g-press relative flex h-14 flex-col items-center justify-center gap-1 rounded-md hover:bg-fill disabled:opacity-50", lit && "bg-fill shadow-[inset_0_0_0_1px_var(--edge)]")}>
              <span className={cn("relative grid transition-opacity duration-(--dur-1)", faded ? "opacity-30 grayscale" : !lit && "opacity-55")}>
                <Logo agent={agent} size={24} />
                {m && <MachineBadge m={m} size={13} />}
              </span>
              {word && <span className="max-w-full truncate px-1 text-[10px] leading-none text-ink-3">{word}</span>}
            </button>
          }
        />
      </Tip>
      {lit && (
        <PopSurface side="bottom" align="center" sideOffset={6} className="w-[min(248px,calc(100vw-16px))]">
          <AgentSet lit={lit} hint={hint} taken={taken} m={m} patch={patch} drop={() => (setOpen(false), drop())} />
        </PopSurface>
      )}
    </Popover.Root>
  );
}

const tileLabel = (a: Agent, m: Machine | undefined, faded: boolean) => (!faded ? (m ? `${agentName(a)} · ${m.name}` : agentName(a)) : m ? t("new.offline", { name: m.name }) : t("new.notInstalled", { name: agentName(a) }));

/** An agent's popup: model, effort, nick, each its default till set; 移出 unlights it. */
function AgentSet({ lit, hint, taken, m, patch, drop }: { lit: Lit; hint: string; taken: (nick: string) => boolean; m?: Machine; patch: (p: Partial<Lit>) => void; drop: () => void }) {
  // What the kind may start with where it would run: as its latest session there said.
  const asked = useQuery({ queryKey: ["agent-choices", lit.agent, "", m?.id ?? ""], queryFn: () => api.agentChoices(lit.agent, { machine: m?.id ?? "" }), staleTime: 60_000 }).data;
  const models = (asked?.models ?? []).filter((x) => x.value !== "default");
  const levels = asked?.efforts ?? [];
  const bad = lit.nick !== "" && (!validNick(lit.nick) || taken(lit.nick));
  const field = "no-ring h-7 w-32 min-w-0 rounded-md bg-fill px-2.5 text-sm placeholder:text-ink-3 pointer-coarse:h-9";
  const row = (label: string, it: ReactNode) => (
    <label className="flex h-9 items-center justify-between gap-3 text-sm pointer-coarse:h-11">
      <span className="shrink-0 text-ink-2">{label}</span>
      {it}
    </label>
  );
  return (
    <div className="flex flex-col gap-0.5 p-2">
      <div className="flex h-7 items-center gap-2">
        <Logo agent={lit.agent} size={16} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{agentName(lit.agent)}</span>
        <Tip label={t("channel.remove")}>
          <button type="button" aria-label={t("channel.remove")} onClick={drop} className="g-press grid size-7 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-fill hover:text-ink">
            <X size={14} />
          </button>
        </Tip>
      </div>
      {row(
        t("composer.model"),
        models.length ? (
          <Choose label={t("composer.model")} value={lit.model} onChange={(v) => patch({ model: v })} options={[{ value: "", label: t("channel.default") }, ...models.map((x) => ({ value: x.value, label: x.name }))]} />
        ) : (
          <input aria-label={t("composer.model")} placeholder={t("channel.default")} value={lit.model} onChange={(e) => patch({ model: e.target.value.trim() })} className={field} />
        ),
      )}
      {levels.length > 1 && row(t("channel.effort"), <Choose label={t("channel.effort")} value={lit.effort} onChange={(v) => patch({ effort: v })} options={[{ value: "", label: t("channel.default") }, ...levels.map((l) => ({ value: l, label: levelName(l) }))]} />)}
      {row(
        t("channel.nick"),
        <input aria-label={t("channel.nick")} aria-invalid={bad || undefined} title={bad ? t(taken(lit.nick) ? "channel.nickTaken" : "channel.nickBad") : undefined} placeholder={hint} value={lit.nick} maxLength={32} onChange={(e) => patch({ nick: e.target.value })} className={cn(field, bad && "text-err")} />,
      )}
    </div>
  );
}

/** The apps, a row each: their logins lit one by one, or all of them by 全选. The one looking is
 *  always lit; the host is always in and is not listed. */
function People({ people, setPeople }: { people: string[]; setPeople: (p: string[]) => void }) {
  const d = useApps().data;
  const me = useMe().data;
  const mine = me?.host ? appAll(me.app) : me?.login ? loginOf(me.app, me.login) : undefined;
  const apps = (d?.apps ?? []).filter((a) => !a.host);
  if (!apps.length) return null;
  const ids = apps.map((a) => a.id);
  const loginsOf = (app: string) => (d?.logins ?? []).filter((l) => l.app === app);
  const idsOf = (app: string) => loginsOf(app).map((l) => l.id);
  const chip = (key: string, on: boolean, locked: boolean, press: () => void, children: ReactNode) => (
    <button key={key} type="button" aria-pressed={on} disabled={locked} onClick={press} className={cn("g-press flex h-7 max-w-full min-w-0 items-center rounded-full px-2.5 text-sm transition-colors duration-(--dur-1) pointer-coarse:h-9", on ? "bg-ink text-on-ink" : "bg-fill text-ink-3 hover:bg-fill-2 hover:text-ink")}>
      {children}
    </button>
  );
  return (
    <section aria-label={t("channel.people")} className="flex flex-col gap-1.5 border-t border-edge pt-2">
      {apps.map((a) => {
        const name = a.web ? t("term.panel") : a.name;
        return (
          <div key={a.id} role="group" aria-label={name} className="flex items-start gap-2">
            <span className="flex h-7 w-[4.5rem] shrink-0 items-center gap-1.5 text-xs text-ink-2 pointer-coarse:h-9">
              <Avatar src={a.avatar} name={a.name} size={16} type={a.type} />
              <span className="min-w-0 truncate">{name}</span>
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1">
              {loginsOf(a.id).map((l) => {
                const it = loginOf(a.id, l.id);
                return chip(it, hasLogin(people, a.id, l.id), it === mine, () => setPeople(pressLogin(people, ids, idsOf, a.id, l.id, mine)), <span className="truncate">{l.name}</span>);
              })}
              {chip("all", hasApp(people, a.id), mine === appAll(a.id), () => setPeople(pressApp(people, ids, idsOf, a.id, mine)), t("channel.allOf"))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
