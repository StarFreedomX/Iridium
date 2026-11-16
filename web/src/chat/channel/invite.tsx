// Adding agents to a channel (docs/channels.md "邀请"; the user, 2026-11-13), under 邀请 among
// the members at the bar's right (top.tsx): the kinds of agent, each row naming the model a press
// of it uses ("Claude · Opus 5.5": never "default", the user, 2026-11-16) and opening the model
// and effort menu the chat's own model key has (that model first; dsh's presets under it). A
// kind's row pressed adds it with that model; a model picked there adds it with that one (kumo,
// 2026-11-15: no filled 添加 key). On a phone (no hover) a press opens the menu, a row there adds.
// The agent joins the channel as a session of its own, ready. The same kind may be added again.
// The roles come first (docs/channels.md "角色"; kumo, 2026-11-16): each by its face, name and
// line, a press adds one as that role; its menu changes the model and effort for this once.
import { Menu } from "@base-ui/react/menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { api } from "../../api/client";
import type { Agent, ChannelMembers, Role } from "../../api/types.gen";
import { agentsQ } from "../../data";
import { useLang } from "../../i18n";
import { picked, RoleFace, RoleLine, RoleModels, roleStart, useRoles, type RolePick } from "../../roles";
import { useList } from "../../store";
import { toast } from "../../toast";
import { AGENTS, cn, Logo } from "../../ui";
import { memberError } from "./key";
import { choicesQ, draftDefault, draftName } from "../choices";
import { DraftModels } from "./pick";

export const ITEM = "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-base outline-none select-none data-highlighted:bg-fill data-popup-open:bg-fill pointer-coarse:h-11";
export const POPUP = "g-unfold glass thick float rounded-lg text-ink outline-none";

/** How many agents a channel holds (internal/server MaxAgents). */
export const MAX_AGENTS = 8;

/** Adds an agent to channel id and keeps the members it answers with; it says hello as it
 *  joins (greet; kumo, 2026-11-16). as: as a role (what
 *  roleStart gives; busy is then "role:<id>"). */
export function useAdd(id: string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const add = async (agent: Agent, model: string, effort: string, preset = "", as?: ReturnType<typeof roleStart>) => {
    setBusy(as ? `role:${as.role}` : agent);
    try {
      qc.setQueryData<ChannelMembers>(["members", id], await api.addMember(id, { ...(as ?? { agent, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(preset ? { preset } : {}) }), greet: true }));
    } catch (e) {
      toast(memberError(e), { error: true });
    } finally {
      setBusy(null);
    }
  };
  return { busy, add };
}

/** The kinds of agent, inside a menu: each a row that adds it when pressed (with a mouse) with
 *  the model it names, its submenu the kind's models (one picked adds it), efforts and presets. */
export function AgentKinds({ id, from = 0 }: { id: string; from?: number }) {
  useLang();
  const row = useList()?.find((x) => x.id === id);
  const info = useQuery(agentsQ).data;
  const kinds = info?.filter((a) => !a.missing).map((a) => a.agent) ?? AGENTS;
  const { busy, add } = useAdd(id);
  const full = (row?.agents?.length ?? 1) >= MAX_AGENTS;
  // The roles of the kinds it can add, first.
  const roles = useRoles().filter((r) => kinds.includes(r.agent));
  return (
    <>
      {roles.map((r, i) => (
        <RoleRow key={r.id} id={id} role={r} i={from + i} off={full || busy !== null} busy={busy === `role:${r.id}`} add={add} />
      ))}
      {roles.length > 0 && <div role="separator" className="mx-2.5 my-1 border-t border-(--edge)" />}
      {kinds.map((k, i) => (
        <Kind key={k} id={id} k={k} i={from + roles.length + i} off={full || busy !== null} busy={busy === k} add={add} />
      ))}
    </>
  );
}

/** One role's row: its face, name and line. Pressed (with a mouse) it adds one as the role;
 *  its submenu changes the model (a pick adds it with that one) and the effort for this once. */
function RoleRow({ id, role, i, off, busy, add }: { id: string; role: Role; i: number; off: boolean; busy: boolean; add: ReturnType<typeof useAdd>["add"] }) {
  const [p, setP] = useState<RolePick>({});
  const as = (pick: RolePick) => void add(role.agent, "", "", "", roleStart(role, pick));
  const press = () => !matchMedia("(pointer: coarse)").matches && as(p);
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger disabled={off} onClick={press} style={{ "--i": i } as CSSProperties} className={cn(ITEM, "data-disabled:opacity-40")}>
        {busy ? <LoaderCircle size={16} className="animate-spin text-ink-3" /> : <RoleFace role={role} size={16} />}
        <span className="max-w-[50%] shrink-0 truncate">{role.name}</span>
        <RoleLine role={picked(role, p)} at={{ channel: id }} logo className="min-w-0 flex-1 text-xs text-ink-3" />
        <ChevronRight size={14} className="shrink-0 text-ink-4" />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner className="z-50" sideOffset={4} collisionPadding={8}>
          <Menu.Popup className={cn(POPUP, "flex max-h-[min(560px,var(--available-height))] w-[min(300px,calc(100vw-16px))] flex-col p-1.5")}>
            <RoleModels role={role} at={{ channel: id }} pick={p} set={(x) => (x.model !== p.model ? as(x) : setP(x))} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

/** One kind's row: its name and the model a press of it uses (not known yet: the name alone). */
function Kind({ id, k, i, off, busy, add }: { id: string; k: Agent; i: number; off: boolean; busy: boolean; add: ReturnType<typeof useAdd>["add"] }) {
  const [p, setP] = useState<{ model: string; effort: string; preset?: string }>({ model: "", effort: "" });
  const asked = useQuery(choicesQ(k, { channel: id })).data;
  const { send } = draftDefault(asked);
  // A mouse's press adds it as it is; a finger's opens its menu (no hover to open it by).
  const press = () => !matchMedia("(pointer: coarse)").matches && void add(k, p.model || send, p.effort, p.preset);
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger disabled={off} onClick={press} style={{ "--i": i } as CSSProperties} className={cn(ITEM, "data-disabled:opacity-40")}>
        {busy ? <LoaderCircle size={16} className="animate-spin text-ink-3" /> : <Logo agent={k} size={16} />}
        <span className="min-w-0 flex-1 truncate">{draftName(k, asked)}</span>
        <ChevronRight size={14} className="shrink-0 text-ink-4" />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner className="z-50" sideOffset={4} collisionPadding={8}>
          <Menu.Popup className={cn(POPUP, "flex max-h-[min(560px,var(--available-height))] w-[min(300px,calc(100vw-16px))] flex-col p-1.5")}>
            <DraftModels agent={k} at={{ channel: id }} model={p.model} effort={p.effort} preset={p.preset} set={(x) => (x.model !== undefined ? void add(k, x.model, p.effort, p.preset) : setP({ ...p, ...x }))} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}
