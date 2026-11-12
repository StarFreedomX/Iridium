// 群聊配置's key (docs/channels.md; the user, 2026-11-12): in a composer's foot, by the attach key,
// the channel's members in a few marks: its agents' logos one over the next, then 全部 or how
// many people. Pressed, the popup (config.tsx, fetched as it first opens). The same key edits a
// chat's members as they are (each change at once) and a new session's draft (nothing sent till
// it is made): what it edits is a Ctl.
import { Popover } from "@base-ui/react/popover";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, type ReactElement } from "react";
import { api, ApiError } from "../../api/client";
import type { Agent, ChannelMembers, NewMember, SessionState } from "../../api/types.gen";
import { useApps } from "../../data";
import { t, useLang } from "../../i18n";
import { getCarried, useList } from "../../store";
import { useMembers } from "./gate";
import { errText } from "../../toast";
import { agentName, cn, LogoStack, PopSurface } from "../../ui";
import { modelView } from "../meters";
import { everyone, mayAct, peopleCount, peopleOf } from "./setup";

const Config = lazy(() => import("./config").then((m) => ({ default: m.Config })));

/** An agent as the popup lists it. own: the session the channel is (never taken out). */
export type Line = { key: string; agent: Agent; nick: string; name: string; recv: string; own: boolean };

/** What an agent of a kind may be started with, as far as known: none known, the model is typed. */
export type Options = { models: { value: string; name: string }[]; levels: string[] };

/** What the popup edits. Each change may fail (thrown): the popup says why, in place. kinds: the
 *  harnesses to add (none: those the daemon hosts). hint: the nick an agent with none gets. */
export type Ctl = {
  lines: Line[];
  people: string[];
  me?: string;
  readOnly: boolean;
  kinds?: Agent[];
  options: (kind: Agent) => Options;
  add: (m: NewMember) => Promise<void> | void;
  remove: (l: Line) => Promise<void> | void;
  patch: (l: Line, p: { nick?: string; recv?: string }) => Promise<void> | void;
  setPeople: (p: string[]) => Promise<void> | void;
  /** Taking one out is asked first (its session is archived). */
  confirm: boolean;
  hint?: (l: Line) => string;
};

/** Why a change of the members was refused, in the page's words. */
export function memberError(e: unknown): string {
  if (e instanceof ApiError) {
    const code = (e.body as { code?: string } | undefined)?.code;
    if (e.status === 409 && code === "full") return t("channel.full");
    if (e.status === 403) return t("channel.forbidden");
    if (e.status === 400 && /nick/i.test(e.message)) return t("channel.nickTaken");
  }
  return errText(e);
}

/** A chat's members as the popup edits them: each change sent at once, the answer the members. */
export function useChannelCtl(channel: string, members: ChannelMembers | undefined): Ctl {
  const qc = useQueryClient();
  const row = useList()?.find((x) => x.id === channel);
  const set = (ms: ChannelMembers) => void qc.setQueryData<ChannelMembers>(["members", channel], ms);
  const agents = members?.members.filter((m) => m.session) ?? [];
  const lines: Line[] = agents.length
    ? agents.map((m) => ({ key: m.member, agent: m.agent ?? row?.agent ?? "claude", nick: m.nick ?? "", name: m.name ?? agentName(m.agent ?? row?.agent ?? "claude"), recv: m.recv, own: m.session === (members?.channel ?? channel) }))
    : row
      ? [{ key: `agent:${channel}`, agent: row.agent, nick: "", name: agentName(row.agent), recv: "all", own: true }]
      : [];
  return {
    lines,
    people: peopleOf(members),
    me: members?.me,
    readOnly: !mayAct(members) || !members,
    confirm: true,
    options: (kind) => {
      const peer = agents.find((m) => m.agent === kind);
      const st = peer && getCarried<SessionState>(`session:${peer.session}`);
      return st ? { models: modelView(st).models.filter((m) => m.value !== "default"), levels: st.efforts ?? [] } : { models: [], levels: [] };
    },
    add: async (m) => set(await api.addMember(channel, m)),
    remove: async (l) => set(await api.removeMember(channel, l.key)),
    patch: async (l, p) => set(await api.patchMember(channel, l.key, p)),
    setPeople: async (p) => set(await api.setPeople(channel, p)),
  };
}

/** The key's few words for the people: 全部, or how many. */
export function usePeopleWord(people: string[]): string {
  useLang();
  const apps = useApps().data;
  if (everyone(people)) return t("channel.everyone");
  return t("channel.peopleN", { n: peopleCount(people, (app) => (apps?.logins ?? []).filter((l) => l.app === app).length) });
}

/** The popup on a trigger of the caller's own (the member bar's "+"). */
export function ConfigPopover({ ctl, trigger, side = "bottom", open, onOpenChange }: { ctl: Ctl; trigger: ReactElement; side?: "top" | "bottom"; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger render={trigger} />
      <PopSurface side={side} align="start" className="flex max-h-[min(560px,calc(var(--available-height)-8px))] w-[min(340px,calc(100vw-16px))] flex-col">
        <Suspense fallback={<div className="h-40" />}>
          <Config ctl={ctl} />
        </Suspense>
      </PopSurface>
    </Popover.Root>
  );
}

/** The key in a composer's foot. */
export function MembersKey({ ctl, className, onOpenChange }: { ctl: Ctl; className?: string; onOpenChange?: (o: boolean) => void }) {
  useLang();
  const word = usePeopleWord(ctl.people);
  const label = `${t("channel.config")}: ${ctl.lines.map((l) => l.nick || agentName(l.agent)).join(", ")} · ${word}`;
  return (
    <ConfigPopover
      ctl={ctl}
      side="top"
      onOpenChange={onOpenChange}
      trigger={
        <button type="button" aria-label={label} className={cn("g-press flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs whitespace-nowrap text-ink-3 hover:bg-fill hover:text-ink data-popup-open:bg-fill pointer-coarse:h-9", className)}>
          <LogoStack agents={ctl.lines.map((l) => l.agent)} size={15} />
          <span>{word}</span>
        </button>
      }
    />
  );
}

/** Where the composer would be, for one not of the channel's people: 未加入, and the members'
 *  key, which still shows who is. */
export function NotJoined({ ctl }: { ctl: Ctl }) {
  return (
    <div className="glass float rest flex h-12 items-center gap-2 rounded-[20px] px-2 text-sm text-ink-3">
      <MembersKey ctl={ctl} />
      <span className="min-w-0 flex-1 truncate pr-10 text-center">{t("channel.notJoined")}</span>
    </div>
  );
}

/** A chat's own key and its line for one not joined, by the chat's id alone: what the one-agent
 *  chat draws, their code fetched apart from it (chat.tsx). */
export function ChannelKey({ id }: { id: string }) {
  return <MembersKey ctl={useChannelCtl(id, useMembers(id))} />;
}
export function NotJoinedOf({ id }: { id: string }) {
  return <NotJoined ctl={useChannelCtl(id, useMembers(id))} />;
}
