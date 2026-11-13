// Adding agents to a channel (docs/channels.md "邀请"; the user, 2026-11-13). 添加, in a
// composer's foot: the kinds of agent, each opening the model and effort menu the chat's own
// model key has; a model chosen there (or 添加, the kind's default), the agent joins the channel
// as a session of its own, ready, and is listed after the key (已邀请). The same kind may be added again. The channel's "⋯" lists the
// same kinds under 邀请 (top.tsx).
import { Menu } from "@base-ui/react/menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, LoaderCircle, Plus, UserPlus, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { api } from "../../api/client";
import type { Agent, ChannelMembers } from "../../api/types.gen";
import { agentsQ } from "../../data";
import { t, useLang } from "../../i18n";
import { useList } from "../../store";
import { toast } from "../../toast";
import { AGENTS, agentName, cn, Logo, Tip } from "../../ui";
import { mayAct, useMembers } from "./gate";
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
  const add = async (agent: Agent, model: string, effort: string) => {
    setBusy(agent);
    try {
      qc.setQueryData<ChannelMembers>(["members", id], await api.addMember(id, { agent, ...(model ? { model } : {}), ...(effort ? { effort } : {}) }));
    } catch (e) {
      toast(memberError(e), { error: true });
    } finally {
      setBusy(null);
    }
  };
  return { busy, add };
}

/** The kinds of agent, inside a menu: each a submenu, the kind's models and efforts, then 添加. */
export function AgentKinds({ id, from = 0 }: { id: string; from?: number }) {
  useLang();
  const row = useList()?.find((x) => x.id === id);
  const info = useQuery(agentsQ).data;
  const kinds = info?.filter((a) => !a.missing).map((a) => a.agent) ?? AGENTS;
  const { busy, add } = useAdd(id);
  const [picked, setPicked] = useState<Partial<Record<Agent, { model: string; effort: string }>>>({});
  const full = (row?.agents?.length ?? 1) >= MAX_AGENTS;
  return (
    <>
      {kinds.map((k, i) => {
        const p = picked[k] ?? { model: "", effort: "" };
        return (
          <Menu.SubmenuRoot key={k}>
            <Menu.SubmenuTrigger disabled={full || busy !== null} style={{ "--i": from + i } as CSSProperties} className={cn(ITEM, "data-disabled:opacity-40")}>
              {busy === k ? <LoaderCircle size={16} className="animate-spin text-ink-3" /> : <Logo agent={k} size={16} />}
              <span className="flex-1">{agentName(k)}</span>
              <ChevronRight size={14} className="text-ink-4" />
            </Menu.SubmenuTrigger>
            <Menu.Portal>
              <Menu.Positioner className="z-50" sideOffset={4} collisionPadding={8}>
                <Menu.Popup className={cn(POPUP, "flex max-h-[min(560px,var(--available-height))] w-[min(300px,calc(100vw-16px))] flex-col p-1.5")}>
                  <DraftModels agent={k} at={{ channel: id }} model={p.model} effort={p.effort} set={(x) => (x.model !== undefined ? void add(k, x.model, p.effort) : setPicked((all) => ({ ...all, [k]: { ...p, ...x } })))} />
                  <Menu.Item onClick={() => void add(k, p.model, p.effort)} className="mt-1 flex h-8 shrink-0 cursor-default items-center justify-center gap-1.5 rounded-md bg-ink text-sm font-medium text-on-ink outline-none select-none data-highlighted:opacity-90 pointer-coarse:h-11">
                    <Plus size={14} />
                    {t("channel.addKey")}
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.SubmenuRoot>
        );
      })}
    </>
  );
}

/** 添加, and after it the agents invited so far: what a composer's foot leads with. */
export default function InviteLead({ id }: { id: string }) {
  useLang();
  const qc = useQueryClient();
  const members = useMembers(id);
  const may = mayAct(members);
  const guests = (members?.members ?? []).filter((m) => m.session && m.send === "ir");
  const remove = async (member: string) => {
    try {
      qc.setQueryData<ChannelMembers>(["members", id], await api.removeMember(id, member));
    } catch (e) {
      toast(memberError(e), { error: true });
    }
  };
  if (!may) return null;
  return (
    <>
      <Menu.Root>
        <Tip label={t("channel.add")} side="top">
          <Menu.Trigger
            render={
              <button type="button" aria-label={t("channel.add")} className="g-press grid size-8 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-fill hover:text-ink data-popup-open:bg-fill pointer-coarse:size-10">
                <UserPlus size={16} />
              </button>
            }
          />
        </Tip>
        <Menu.Portal>
          <Menu.Positioner side="top" align="start" sideOffset={6} collisionPadding={8} className="z-50">
            <Menu.Popup className={cn(POPUP, "min-w-44 p-1.5")}>
              <div className="g-stagger flex flex-col">
                <AgentKinds id={id} />
              </div>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {guests.length > 0 && (
        <div role="list" aria-label={t("channel.invited")} className="flex shrink-0 items-center gap-1">
          <span className="shrink-0 text-xs text-ink-4">{t("channel.invited")}</span>
          {guests.map((m) => (
            <span key={m.member} role="listitem" className="group/inv g-fade flex h-6 shrink-0 items-center gap-1 rounded-full bg-fill pr-1 pl-1.5 text-xs text-ink-2 pointer-coarse:h-8">
              {m.agent && <Logo agent={m.agent} size={12} />}
              <span className="max-w-24 truncate">{m.nick}</span>
              <button type="button" aria-label={t("channel.removeTitle", { nick: m.nick ?? "" })} onClick={() => void remove(m.member)} className="g-press grid size-4 place-items-center rounded-full text-ink-4 hover:bg-fill-2 hover:text-ink pointer-coarse:size-6">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
