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
import { LoaderCircle } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { api } from "../../api/client";
import type { Agent, ChannelMembers, Role } from "../../api/types.gen";
import { agentsQ, useMachines } from "../../data";
import { t, useLang } from "../../i18n";
import { MachineFace, type Machine } from "../../machines";
import { RoleFace, roleStart, useRoles } from "../../roles";
import { useList, useSession } from "../../store";
import { toast } from "../../toast";
import { AGENTS, agentName, cn, Logo, MenuPortal } from "../../ui";
import { memberError } from "./key";
import { choicesQ, draftDefault, draftName } from "../choices";
import { DraftModels } from "./pick";

export const ITEM = "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-base outline-none select-none data-highlighted:bg-fill data-popup-open:bg-fill pointer-coarse:h-11";
export const POPUP = "g-unfold glass thick float rounded-lg text-ink outline-none";

/** How many agents a channel holds (internal/server MaxAgents). */
export const MAX_AGENTS = 8;

/** Adds an agent to channel id and keeps the members it answers with; it says hello as it
 *  joins (greet; kumo, 2026-11-16). as: as a role (what
 *  roleStart gives; busy is then "role:<id>"). m: at that computer, in its home folder (busy:
 *  "<machine>/<agent>"). */
export function useAdd(id: string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const add = async (agent: Agent, model: string, effort: string, preset = "", as?: ReturnType<typeof roleStart>, m?: Machine) => {
    setBusy(as ? `role:${as.role}` : m ? `${m.id}/${agent}` : agent);
    try {
      qc.setQueryData<ChannelMembers>(["members", id], await api.addMember(id, { ...(as ?? { agent, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(preset ? { preset } : {}) }), ...(m ? { machine: m.id, cwd: m.home } : {}), greet: true }));
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
export function AddAgents({ id, onKind }: { id: string; onKind?: (k: Agent, m?: Machine) => void }) {
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
  const { busy, add } = useAdd(id);
  const full = (row?.agents?.length ?? 1) >= MAX_AGENTS;
  const off = full || busy !== null;
  // Where one added runs when not at the channel's own computer: the one picked, its home folder.
  const to = m && picked !== own ? m : undefined;
  return (
    <>
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
        <RoleRow key={r.id} role={r} i={i} off={off || !has.includes(r.agent) || (!!r.machine && r.machine !== picked)} busy={busy === `role:${r.id}`} add={() => void add(r.agent, "", "", "", roleStart(r), to)} />
      ))}
      {roles.length > 0 && <div role="separator" className="mx-2.5 my-1 border-t border-(--edge)" />}
      {kinds.map((k, i) => (
        <Kind key={`${picked}/${k}`} id={id} k={k} m={to} lacks={!has.includes(k)} onPage={onKind && (() => onKind(k, to))} i={roles.length + i} off={off || !has.includes(k)} busy={busy === (to ? `${to.id}/${k}` : k)} add={add} />
      ))}
    </>
  );
}

/** One template's row: its face and name alone (kumo, 2026-11-25: a template, no model to pick
 *  as it is added; its model and effort are changed on the member afterwards). Pressed, it adds
 *  one as the role. */
function RoleRow({ role, i, off, busy, add }: { role: Role; i: number; off: boolean; busy: boolean; add: () => void }) {
  return (
    <Menu.Item closeOnClick={false} disabled={off} onClick={add} style={{ "--i": i } as CSSProperties} className={cn(ITEM, "data-disabled:opacity-40")}>
      {busy ? <LoaderCircle size={16} className="animate-spin text-ink-3" /> : <RoleFace role={role} size={16} />}
      <span className="min-w-0 flex-1 truncate">{role.name}</span>
    </Menu.Item>
  );
}

/** One kind's row: its name and the model a press of it uses (not known yet: the name alone,
 *  and no menu: a press adds it as it is). lacks: the computer picked has no such agent; its
 *  name alone, nothing asked of it. Its models open beside it, with no mark of it at the row's
 *  end (kumo, 2026-11-25); onPage (a finger's): pressed, they are the panel's next page, no
 *  menu of its own. */
function Kind({ id, k, m, lacks, onPage, i, off, busy, add }: { id: string; k: Agent; m?: Machine; lacks?: boolean; onPage?: () => void; i: number; off: boolean; busy: boolean; add: ReturnType<typeof useAdd>["add"] }) {
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
  if (!asked?.models.length || onPage)
    return (
      <Menu.Item closeOnClick={false} disabled={off} onClick={asked?.models.length && onPage ? onPage : plain} style={style} className={cls}>
        {row}
      </Menu.Item>
    );
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger disabled={off} onClick={plain} style={style} className={cls}>
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

/** A kind's models as the panel's page (a finger's: no menu beside the row): one picked adds it
 *  with that one and the page is done. */
export function KindPage({ id, k, m, done }: { id: string; k: Agent; m?: Machine; done: () => void }) {
  const at = m ? { machine: m.id } : { channel: id };
  const [p, setP] = useState<{ model: string; effort: string; preset?: string }>({ model: "", effort: "" });
  const { add } = useAdd(id);
  return <DraftModels agent={k} at={at} model={p.model} effort={p.effort} preset={p.preset} set={(x) => (x.model !== undefined ? (void add(k, x.model, p.effort, p.preset, undefined, m), done()) : setP({ ...p, ...x }))} />;
}
