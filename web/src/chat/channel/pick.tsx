// What the "+" (draft.tsx) and the chat's 群聊配置 (config.tsx) share (the user, 2026-11-12): the
// kinds in a row, each press one more agent of it (the same kind as often as wanted); the agents
// chosen in a strip of their own, a face each, its menu the composer's model menu with its nick
// on top; the apps' logins as chips, a row an app, its name the chip for all of them. No headings,
// nothing black.
import { Menu } from "@base-ui/react/menu";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { type CSSProperties, type ReactNode } from "react";
import { api } from "../../api/client";
import type { Agent } from "../../api/types.gen";
import { useApps } from "../../data";
import { t } from "../../i18n";
import { MachineBadge, type Machine } from "../../machines";
import { agentName, Avatar, cn, Logo, Tip } from "../../ui";
import { ModelList, modelView } from "../meters";
import { validNick } from "./lib";
import { appAll, hasApp, hasLogin, loginOf, pressApp, pressLogin } from "./setup";

/** The nick a new agent of kind gets: the harness's name, then name2, name3… (as the server's
 *  freeNick makes them). */
export function freeNick(kind: Agent, taken: string[]): string {
  const have = new Set(taken.map((n) => n.toLowerCase()));
  const base = kind.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, "") || "agent";
  let nick = base;
  for (let k = 2; have.has(nick); k++) nick = `${base}${k}`;
  return nick;
}

/** The kinds: a press adds one more of it. */
export function Kinds({ kinds, missing, m, off, add }: { kinds: Agent[]; missing?: (a: Agent) => boolean; m?: Machine; off?: boolean; add: (a: Agent) => void }) {
  return (
    <div role="group" aria-label={t("new.agent")} className="g-stagger grid grid-cols-4 gap-1">
      {kinds.map((a, i) => {
        const gone = !!missing?.(a) || (!!m && !m.online);
        const label = !gone ? (m ? `${agentName(a)} · ${m.name}` : agentName(a)) : m ? t("new.offline", { name: m.name }) : t("new.notInstalled", { name: agentName(a) });
        return (
          <Tip key={a} label={label}>
            <button type="button" aria-label={label} disabled={off || !!missing?.(a)} onClick={() => add(a)} style={{ "--i": i } as CSSProperties} className="g-press grid h-12 place-items-center rounded-md hover:bg-fill disabled:opacity-50">
              <span className={cn("relative grid", gone && "opacity-30 grayscale")}>
                <Logo agent={a} size={24} />
                {m && <MachineBadge m={m} size={13} />}
              </span>
            </button>
          </Tip>
        );
      })}
    </div>
  );
}

/** The agents chosen, a face each; none, an empty place for them. */
export function Strip({ children, empty }: { children: ReactNode; empty: boolean }) {
  return <div className={cn("flex min-h-[3.75rem] flex-wrap items-center gap-1 rounded-lg p-1", empty ? "border border-dashed border-(--edge)" : "bg-fill")}>{children}</div>;
}

/** One agent's face and its menu: its nick on top (prefilled; changed in place), then what is
 *  given (aside: its receive key), then the model menu. */
export function Member({ agent, nick, open, setOpen, taken, setNick, remove, aside, readOnly, children }: { agent: Agent; nick: string; readOnly?: boolean; open: boolean; setOpen: (o: boolean) => void; taken: (n: string) => boolean; setNick: (n: string) => void; remove?: () => void; aside?: ReactNode; children?: ReactNode }) {
  const bad = !validNick(nick) || taken(nick);
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger
        render={
          <button type="button" aria-label={nick || agentName(agent)} className="g-press g-pop flex h-[3.25rem] w-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md hover:bg-fill-2 data-popup-open:bg-fill-2">
            <span className="grid size-7 place-items-center rounded-full bg-paper shadow-[0_0_0_0.5px_var(--edge)]">
              <Logo agent={agent} size={16} />
            </span>
            <span className="max-w-full truncate px-0.5 text-[11px] leading-none text-ink-2">{nick || agentName(agent)}</span>
          </button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} className="z-50">
          <Menu.Popup finalFocus={false} className="g-unfold glass thick float flex max-h-[min(560px,calc(var(--available-height)-16px))] w-72 max-w-[calc(100vw-16px)] flex-col rounded-lg p-1.5 text-ink outline-none">
            <div className="flex h-9 shrink-0 items-center gap-2 pl-2 pointer-coarse:h-11">
              <Logo agent={agent} size={16} />
              <input
                aria-label={t("channel.nick")}
                aria-invalid={bad || undefined}
                title={bad ? t(taken(nick) ? "channel.nickTaken" : "channel.nickBad") : undefined}
                value={nick}
                readOnly={readOnly}
                maxLength={32}
                onChange={(e) => setNick(e.target.value)}
                // The menu's own keys (typeahead, arrows) stay out of the field.
                onKeyDown={(e) => {
                  if (e.key !== "Escape") e.stopPropagation();
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className={cn("no-ring h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-base font-medium hover:bg-fill focus:bg-fill", bad && "text-err")}
              />
              {aside}
              {remove && (
                <Tip label={t("channel.remove")}>
                  <button type="button" aria-label={t("channel.remove")} onClick={remove} className="g-press grid size-7 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-fill hover:text-ink">
                    <X size={14} />
                  </button>
                </Tip>
              )}
            </div>
            {children && <div className="mt-0.5 flex min-h-0 flex-col border-t border-(--edge) pt-1">{children}</div>}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The model menu for an agent not yet started: its kind's models where it would run (GET
 *  …/choices), else those the page knows; model "" its default. */
export function DraftModels({ agent, at, model, effort, set }: { agent: Agent; at: { channel?: string; machine?: string }; model: string; effort: string; set: (p: { model?: string; effort?: string }) => void }) {
  const asked = useQuery({ queryKey: ["agent-choices", agent, at.channel ?? "", at.machine ?? ""], queryFn: () => api.agentChoices(agent, at), staleTime: 60_000 }).data;
  const v = modelView({ agent, models: asked?.models.length ? asked.models : undefined, efforts: asked?.efforts, pick: model, model, effort });
  if (!v.models.length) return null;
  return <ModelList models={v.models} value={v.value} pickModel={(x) => set({ model: x === "default" ? "" : x })} levels={v.levels} level={v.level} setEffort={async (e) => (set({ effort: e }), true)} />;
}

/** The apps, a row each: the app's name lights all of its logins, a login itself; me is always
 *  lit. The host is always in and is not listed. */
export function PeopleChips({ people, me, off, set }: { people: string[]; me?: string; off?: boolean; set: (p: string[]) => void }) {
  const d = useApps().data;
  const apps = (d?.apps ?? []).filter((a) => !a.host);
  if (!apps.length) return null;
  const ids = apps.map((a) => a.id);
  const loginsOf = (app: string) => (d?.logins ?? []).filter((l) => l.app === app);
  const idsOf = (app: string) => loginsOf(app).map((l) => l.id);
  const chip = (key: string, label: string, on: boolean, locked: boolean, press: () => void, face: ReactNode, strong?: boolean) => (
    <button key={key} type="button" aria-pressed={on} aria-label={label} disabled={off || locked} onClick={press} className={cn("g-press flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full pr-2.5 pl-1 text-sm transition-[background-color,color,box-shadow] duration-(--dur-1) pointer-coarse:h-9", on ? "bg-fill text-ink shadow-[inset_0_0_0_1px_var(--edge)]" : "text-ink-4 enabled:hover:bg-fill enabled:hover:text-ink-2", strong && "font-medium")}>
      <span className={cn("grid transition-opacity duration-(--dur-1)", !on && "opacity-40 grayscale")}>{face}</span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
  return (
    <section aria-label={t("channel.people")} className="flex flex-col gap-1">
      {apps.map((a) => {
        const name = a.web ? t("term.panel") : a.name;
        return (
          <div key={a.id} role="group" aria-label={name} className="flex flex-wrap gap-1">
            {chip(a.id, name, hasApp(people, a.id), me === appAll(a.id), () => set(pressApp(people, ids, idsOf, a.id, me)), <Avatar src={a.avatar} name={a.name} size={20} type={a.type} />, true)}
            {loginsOf(a.id).map((l) => {
              const it = loginOf(a.id, l.id);
              return chip(it, l.name, hasLogin(people, a.id, l.id), it === me, () => set(pressLogin(people, ids, idsOf, a.id, l.id, me)), <Avatar src={l.avatar} name={l.name} size={20} />);
            })}
          </div>
        );
      })}
    </section>
  );
}
