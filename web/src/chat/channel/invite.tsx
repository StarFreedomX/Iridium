// Adding agents to a channel (docs/channels.md "邀请"; the user, 2026-11-13), under 邀请 among
// the members at the bar's right (top.tsx): the kinds of agent, each opening the model and effort
// menu the chat's own model key has (its default marked 默认; dsh's presets under it). A kind's
// row pressed adds it with its default; a model picked there adds it with that model (kumo,
// 2026-11-15: no filled 添加 key). On a phone (no hover) a press opens the menu, its 默认 row adds.
// The agent joins the channel as a session of its own, ready. The same kind may be added again.
import { Menu } from "@base-ui/react/menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { api } from "../../api/client";
import type { Agent, ChannelMembers } from "../../api/types.gen";
import { agentsQ } from "../../data";
import { useLang } from "../../i18n";
import { useList } from "../../store";
import { toast } from "../../toast";
import { AGENTS, agentName, cn, Logo } from "../../ui";
import { memberError } from "./key";
import { DraftModels } from "./pick";

export const ITEM = "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-base outline-none select-none data-highlighted:bg-fill data-popup-open:bg-fill pointer-coarse:h-11";
export const POPUP = "g-unfold glass thick float rounded-lg text-ink outline-none";

/** How many agents a channel holds (internal/server MaxAgents). */
export const MAX_AGENTS = 8;

/** Adds an agent to channel id and keeps the members it answers with. */
export function useAdd(id: string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Agent | null>(null);
  const add = async (agent: Agent, model: string, effort: string, preset = "") => {
    setBusy(agent);
    try {
      qc.setQueryData<ChannelMembers>(["members", id], await api.addMember(id, { agent, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(preset ? { preset } : {}) }));
    } catch (e) {
      toast(memberError(e), { error: true });
    } finally {
      setBusy(null);
    }
  };
  return { busy, add };
}

/** The kinds of agent, inside a menu: each a row that adds it with its default when pressed (with
 *  a mouse), its submenu the kind's models (one picked adds it), efforts and presets. */
export function AgentKinds({ id, from = 0 }: { id: string; from?: number }) {
  useLang();
  const row = useList()?.find((x) => x.id === id);
  const info = useQuery(agentsQ).data;
  const kinds = info?.filter((a) => !a.missing).map((a) => a.agent) ?? AGENTS;
  const { busy, add } = useAdd(id);
  const [picked, setPicked] = useState<Partial<Record<Agent, { model: string; effort: string; preset?: string }>>>({});
  const full = (row?.agents?.length ?? 1) >= MAX_AGENTS;
  return (
    <>
      {kinds.map((k, i) => {
        const p = picked[k] ?? { model: "", effort: "" };
        // A mouse's press adds it as it is; a finger's opens its menu (no hover to open it by).
        const press = () => !matchMedia("(pointer: coarse)").matches && void add(k, p.model, p.effort, p.preset);
        return (
          <Menu.SubmenuRoot key={k}>
            <Menu.SubmenuTrigger disabled={full || busy !== null} onClick={press} style={{ "--i": from + i } as CSSProperties} className={cn(ITEM, "data-disabled:opacity-40")}>
              {busy === k ? <LoaderCircle size={16} className="animate-spin text-ink-3" /> : <Logo agent={k} size={16} />}
              <span className="flex-1">{agentName(k)}</span>
              <ChevronRight size={14} className="text-ink-4" />
            </Menu.SubmenuTrigger>
            <Menu.Portal>
              <Menu.Positioner className="z-50" sideOffset={4} collisionPadding={8}>
                <Menu.Popup className={cn(POPUP, "flex max-h-[min(560px,var(--available-height))] w-[min(300px,calc(100vw-16px))] flex-col p-1.5")}>
                  <DraftModels agent={k} at={{ channel: id }} model={p.model} effort={p.effort} preset={p.preset} set={(x) => (x.model !== undefined ? void add(k, x.model, p.effort, p.preset) : setPicked((all) => ({ ...all, [k]: { ...p, ...x } })))} />
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.SubmenuRoot>
        );
      })}
    </>
  );
}
