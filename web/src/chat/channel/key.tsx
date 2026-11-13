// What changes a channel's members (docs/channels.md), and the line shown in the composer's
// place to one who is not of its people.
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api/client";
import type { Agent, ChannelMembers, NewMember, SessionState } from "../../api/types.gen";
import { t, useLang } from "../../i18n";
import { getCarried, useList } from "../../store";
import { useMembers } from "./gate";
import { errText } from "../../toast";
import { agentName } from "../../ui";
import { modelView } from "../meters";
import { mayAct, peopleOf } from "./setup";

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
  /** Where a new agent would run: the channel, or (a draft) the folder's machine; its choices
   *  are asked there when options knows none. */
  at?: { channel?: string; machine?: string };
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
    at: { channel },
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

/** Where the composer would be, for one not of the channel's people: 未加入. */
export function NotJoined(_: { ctl: Ctl }) {
  useLang();
  return <div className="glass float rest flex h-12 items-center justify-center rounded-[20px] px-4 text-sm text-ink-3">{t("channel.notJoined")}</div>;
}

/** The line for one not joined, by the chat's id alone: what the one-agent chat draws, its code
 *  fetched apart from it (chat.tsx). */
export function NotJoinedOf({ id }: { id: string }) {
  return <NotJoined ctl={useChannelCtl(id, useMembers(id))} />;
}
