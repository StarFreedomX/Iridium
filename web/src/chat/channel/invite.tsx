// Adding agents to a channel (docs/channels.md "邀请"; kumo, 2026-11-25), under the + beside the
// members' key at the bar's right (top.tsx). At its top the computers, one picked (AddAgents);
// under them the templates (roles: face and name, a press adds one as that role) and the kinds
// of agent, each row naming the model a press of it uses ("Claude · Opus 5.5": never "default",
// the user, 2026-11-16) and opening the model and effort menu the chat's own model key has. A
// kind's row pressed adds it with that model; a model picked there adds it with that one (kumo,
// 2026-11-15: no filled 添加 key). On a phone (no hover) a press opens the menu, a row there adds.
// The agent joins the channel as a session of its own, ready. The same kind may be added again.
// One of another computer runs there, in that computer's home folder (docs/channels.md "别的电脑
// 的 agent").
import { Menu } from "@base-ui/react/menu";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "../../api/query";
import { LoaderCircle, Mail, Plus } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { api } from "../../api/client";
import type { Agent, ChannelMembers, Role, Trigger } from "../../api/types.gen";
import { agentsQ, useMachines } from "../../data";
import { t, useLang } from "../../i18n";
import { MachineFace, type Machine } from "../../machines";
import { RoleFace, RoleLine, roleStart, useRoles } from "../../roles";
import { useList, useSession } from "../../store";
import { toast } from "../../toast";
import { AGENTS, agentName, cn, Logo, MenuPortal } from "../../ui";
import { useMembers } from "./gate";
import { memberError } from "./key";
import { Deeper, usePages } from "./pages";
import { choicesQ, draftDefault, draftName, type At } from "../choices";
import { CARD_POP, ProfileCard } from "./profilecard";
import { DraftModels } from "./pick";
import { ahead as figAhead } from "../../splash/engine";
import { point, type Fig } from "../../splash/figure";

/** A row pointed at or come to by the keys: the splash draws what it would add (splash/). */
const pointing = (f: Fig) => ({ onPointerEnter: () => point(f), onFocus: () => point(f) });

export const ITEM = "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-base outline-none select-none data-highlighted:bg-fill data-popup-open:bg-fill pointer-coarse:h-11";
export const POPUP = "g-unfold glass thick float rounded-lg text-ink outline-none";

/** How many agents a channel holds (internal/server MaxAgents). */
export const MAX_AGENTS = 8;

/** What wakes one added beside its @ (kumo, 2026-11-25): only the one adding it (self: the
 *  channel's first agent's at first), only an @ (at: one added after it), or every member's
 *  words (all). A press goes on to the next. */
export type Wake = "self" | "at" | "all";
export const WAKES: Wake[] = ["self", "at", "all"];
const wakeOn = (w: Wake, me?: string): Trigger[] => (w === "all" ? [{ message: { from: ["*"] } }] : w === "self" && me ? [{ message: { from: [me] } }] : []);

/** Adds an agent to channel id and keeps the members it answers with; it says hello as it
 *  joins (greet; kumo, 2026-11-16). as: as a role (what
 *  roleStart gives; busy is then "role:<id>"). m: at that computer, in its home folder (busy:
 *  "<machine>/<agent>"). wake: what wakes it beside its @ (Wake; none given, only its @). */
export function useAdd(id: string, wake?: Wake) {
  const qc = useQueryClient();
  const me = useMembers(id)?.me;
  const [busy, setBusy] = useState<string | null>(null);
  const add = async (agent: Agent, model: string, effort: string, preset = "", as?: ReturnType<typeof roleStart>, m?: Machine) => {
    setBusy(as ? `role:${as.role}` : m ? `${m.id}/${agent}` : agent);
    try {
      qc.setQueryData<ChannelMembers>(["members", id], await api.addMember(id, { ...(as ?? { agent, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(preset ? { preset } : {}) }), ...(m ? { machine: m.id, cwd: m.home } : {}), ...(wake ? { on: wakeOn(wake, me) } : {}), greet: true }));
    } catch (e) {
      toast(memberError(e), { error: true });
    } finally {
      setBusy(null);
    }
  };
  return { busy, add };
}

/** The agents to add, inside a menu (kumo, 2026-11-25): the computers in one row at its top
 *  (scrolled sideways, no bar; the channel's own picked as it opens), then the templates (roles)
 *  and the kinds of agent of the one picked. Every template and every kind any computer has
 *  keeps its row whichever is picked, one the picked computer lacks drawn faint and not pressed:
 *  the menu is as tall for each computer. */
export function AddAgents({ id, wake, setWake }: { id: string; wake: Wake; setWake: (w: Wake) => void }) {
  useLang();
  const row = useList()?.find((x) => x.id === id);
  const own = (useSession(id) ?? row)?.machine ?? "";
  const machines = useMachines(true);
  const [picked, setPicked] = useState(own);
  const m = machines.find((x) => x.id === picked);
  const info = useQuery(agentsQ).data;
  const local = info?.filter((a) => !a.missing).map((a) => a.agent) ?? [];
  const kindsOf = (x?: Machine): Agent[] => (!x || !x.id ? local : x.online ? x.agents.map((a) => a.agent as Agent) : []);
  const has = kindsOf(m);
  // The rows: the kinds any computer has, in the kinds' own order.
  const every = new Set<Agent>([...local, ...machines.flatMap((x) => (x.id ? x.agents.map((a) => a.agent as Agent) : []))]);
  const kinds = AGENTS.filter((k) => every.has(k));
  const roles = useRoles();
  const { busy, add } = useAdd(id, wake);
  const full = (row?.agents?.length ?? 1) >= MAX_AGENTS;
  const off = full || busy !== null;
  // Where one added runs when not at the channel's own computer: the one picked, its home folder.
  const to = m && picked !== own ? m : undefined;
  // The panel gone: the splash is the channel's own again. The templates' faces asked for as it
  // is drawn: one pointed at is there to be drawn.
  useEffect(() => () => point(null), []);
  useEffect(() => roles.forEach((r) => r.avatar && figAhead({ key: r.id, src: r.avatar })), [roles]);
  return (
    <>
      {/* What wakes the one added, at the head (kumo, 2026-11-25): a press goes on to the next. */}
      <Menu.Item closeOnClick={false} onClick={() => setWake(WAKES[(WAKES.indexOf(wake) + 1) % WAKES.length]!)} className={ITEM}>
        <span className="text-ink-2">
          <Mail size={15} />
        </span>
        <span className="min-w-0 flex-1 truncate">{t("channel.recv")}</span>
        <span key={wake} className="g-fade shrink-0 text-sm text-ink-2">
          {t(`wake.${wake}`)}
        </span>
      </Menu.Item>
      <div role="separator" className="mx-2.5 my-1 border-t border-(--edge)" />
      {machines.length > 1 && (
        // As wide as the menu is without it: the row scrolls, it does not widen the menu.
        <div className="no-bar mb-1 flex w-0 min-w-full gap-1 overflow-x-auto">
          {machines.map((x) => (
            <button key={x.id} type="button" disabled={!!x.id && !x.online} aria-pressed={x.id === picked} onClick={() => setPicked(x.id)} className={cn("g-press flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 outline-none select-none hover:bg-fill disabled:opacity-40 disabled:grayscale aria-pressed:bg-fill aria-pressed:text-ink pointer-coarse:h-9")}>
              <MachineFace m={x} size={14} />
              <span className="max-w-32 truncate">{x.id ? x.name : t("term.local")}</span>
            </button>
          ))}
        </div>
      )}
      {roles.map((r, i) => (
        <RoleRow key={r.id} role={r} at={to ? { machine: to.id } : { channel: id }} i={i} off={off || !has.includes(r.agent) || (!!r.machine && r.machine !== picked)} busy={busy === `role:${r.id}`} add={() => void add(r.agent, "", "", "", roleStart(r), to)} />
      ))}
      {roles.length > 0 && <div role="separator" className="mx-2.5 my-1 border-t border-(--edge)" />}
      {kinds.map((k, i) => (
        <Kind key={`${picked}/${k}`} id={id} k={k} m={to} lacks={!has.includes(k)} i={roles.length + i} off={off || !has.includes(k)} busy={busy === (to ? `${to.id}/${k}` : k)} add={add} />
      ))}
    </>
  );
}

/** One template's row: its face and name alone (kumo, 2026-11-25: a template, no model to pick
 *  as it is added; its model and effort are changed on the member afterwards). Pressed, it adds
 *  one as the role; pointed at, its card beside it (RolePreview), 添加 there too. In the phone's
 *  layout (Paged): pressed, its card is the panel's next page, added from there. */
function RoleRow({ role, at, i, off, busy, add }: { role: Role; at: At; i: number; off: boolean; busy: boolean; add: () => void }) {
  const pages = usePages();
  const style = { "--i": i } as CSSProperties;
  const cls = cn(ITEM, "data-disabled:opacity-40");
  const fig = pointing({ key: `role:${role.id}:${role.avatar ?? ""}`, src: role.avatar || undefined, agent: role.agent });
  const row = (
    <>
      {busy ? <LoaderCircle size={16} className="animate-spin text-ink-3" /> : <RoleFace role={role} size={16} />}
      <span className="min-w-0 flex-1 truncate">{role.name}</span>
    </>
  );
  if (pages)
    return (
      <Deeper row={row} title={role.name} i={i} popup="">
        {/* Its card inside the panel's padding, its corners round as the panel's rows. */}
        <div className="overflow-hidden rounded-md">
          <RolePreview role={role} at={at} off={off} busy={busy} add={() => (add(), pages.pop())} />
        </div>
      </Deeper>
    );
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger disabled={off} onClick={add} style={style} className={cls} {...fig}>
        {row}
      </Menu.SubmenuTrigger>
      <MenuPortal>
        <Menu.Positioner className="z-50" sideOffset={4} collisionPadding={8}>
          <Menu.Popup className={cn(POPUP, CARD_POP)}>
            <RolePreview role={role} at={at} off={off} busy={busy} add={add} />
          </Menu.Popup>
        </Menu.Positioner>
      </MenuPortal>
    </Menu.SubmenuRoot>
  );
}

/** A template as its card shows it, to be seen, not changed (kumo, 2026-11-25): its face, name,
 *  what it runs as, its persona; 添加 under them. */
export function RolePreview({ role, at, off, busy, add }: { role: Role; at: At; off: boolean; busy: boolean; add: () => void }) {
  return (
    <ProfileCard
      face={<RoleFace role={role} size={56} />}
      name={role.name}
      sub={<RoleLine role={role} at={at} />}
      more={role.persona ? <p className="m-0 line-clamp-6 pt-2 text-sm leading-5 whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">{role.persona}</p> : undefined}
      keys={[{ icon: busy ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />, label: t("role.add"), run: add, disabled: off }]}
    />
  );
}

/** One kind's row: its name and the model a press of it uses (not known yet: the name alone,
 *  and no menu: a press adds it as it is). lacks: the computer picked has no such agent; its
 *  name alone, nothing asked of it. Its models open beside it, with no mark of it at the row's
 *  end (kumo, 2026-11-25); in the phone's layout (Paged), pressed, they are the panel's next page.
 *  */
function Kind({ id, k, m, lacks, i, off, busy, add }: { id: string; k: Agent; m?: Machine; lacks?: boolean; i: number; off: boolean; busy: boolean; add: ReturnType<typeof useAdd>["add"] }) {
  const pages = usePages();
  // Where its models are asked: the channel's own place, or the computer it would run at.
  const at = m ? { machine: m.id } : { channel: id };
  const [p, setP] = useState<{ model: string; effort: string; preset?: string }>({ model: "", effort: "" });
  const asked = useQuery({ ...choicesQ(k, at), enabled: !lacks }).data;
  const { send } = draftDefault(asked);
  const row = (
    <>
      {busy ? <LoaderCircle size={16} className="animate-spin text-ink-3" /> : <Logo agent={k} size={16} />}
      <span className="min-w-0 flex-1 truncate">{lacks ? agentName(k) : draftName(k, asked)}</span>
    </>
  );
  const style = { "--i": i } as CSSProperties;
  const cls = cn(ITEM, "data-disabled:opacity-40");
  const plain = () => void add(k, p.model || send, p.effort, p.preset, undefined, m);
  const fig = pointing({ key: `kind:${k}`, agent: k });
  if (pages && asked?.models.length)
    return (
      <Deeper row={row} title={agentName(k)} i={i} popup="" disabled={off}>
        <KindPage k={k} at={at} add={(model, effort, preset) => (void add(k, model, effort, preset, undefined, m), pages.pop())} />
      </Deeper>
    );
  if (!asked?.models.length)
    return (
      <Menu.Item closeOnClick={false} disabled={off} onClick={plain} style={style} className={cls} {...fig}>
        {row}
      </Menu.Item>
    );
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger disabled={off} onClick={plain} style={style} className={cls} {...fig}>
        {row}
      </Menu.SubmenuTrigger>
      <MenuPortal>
        <Menu.Positioner className="z-50" sideOffset={4} collisionPadding={8}>
          <Menu.Popup className={cn(POPUP, "flex max-h-[min(560px,var(--available-height))] w-[min(300px,calc(100vw-16px))] flex-col p-1.5")}>
            <DraftModels agent={k} at={at} model={p.model} effort={p.effort} preset={p.preset} set={(x) => (x.model !== undefined ? void add(k, x.model, p.effort, p.preset, undefined, m) : setP({ ...p, ...x }))} />
          </Menu.Popup>
        </Menu.Positioner>
      </MenuPortal>
    </Menu.SubmenuRoot>
  );
}

/** A kind's models as the panel's page (the phone's layout: no menu beside the row): one picked
 *  adds it with that one (add), the effort set first. */
function KindPage({ k, at, add }: { k: Agent; at: At; add: (model: string, effort: string, preset?: string) => void }) {
  const [p, setP] = useState<{ model: string; effort: string; preset?: string }>({ model: "", effort: "" });
  return <DraftModels agent={k} at={at} model={p.model} effort={p.effort} preset={p.preset} set={(x) => (x.model !== undefined ? add(x.model, p.effort, p.preset) : setP({ ...p, ...x }))} />;
}
