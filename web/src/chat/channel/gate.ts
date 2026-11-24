// A channel's members as the page asks for them (docs/channels.md), apart from what draws them:
// a chat needs them to know whether the one looking is of its people.
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useQuery } from "../../api/query";
import { useEffect, useRef } from "react";
import { api } from "../../api/client";
import type { ChannelMembers, Memory, Profile } from "../../api/types.gen";
import { hostPersonasQ } from "../../persona";
import { useCarried } from "../../store";
import { userOf } from "./lib";

/** A channel's members (GET …/members), asked again whenever any channel's members change (the
 *  carried "channels") or sig does (what its agents run as). */
export function useMembers(id: string, sig = "") {
  const seq = useCarried<number>("channels");
  const qc = useQueryClient();
  // Those just asked for (by another part of the page, or come with the first screen) are not
  // asked for again as each part that reads them is drawn.
  const q = useQuery({ queryKey: ["members", id], queryFn: () => api.members(id), staleTime: 5_000, retry: false });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    void qc.invalidateQueries({ queryKey: ["members", id] });
  }, [seq, sig, id, qc]);
  // Its members' cards asked ahead, its agents' and its people's (and this Iridium's own, the
  // face of what is said from here): a card pressed open at a face is drawn whole, its intro,
  // background and keys not come a moment after, the card grown (docs/前端设计规范.md "弹窗、页面
  // 打开时就是完整的").
  const data = q.data as ChannelMembers | undefined;
  const who = data ? ["local", ...data.members.map((m) => (m.session ? m.member : userOf(m.member)))].join(" ") : "";
  useEffect(() => {
    for (const w of who ? new Set(who.split(" ")) : []) void qc.prefetchQuery({ queryKey: ["card", w], queryFn: () => api.memberCard(w), staleTime: 30_000, retry: false });
  }, [who, qc]);
  return q.data as ChannelMembers | undefined;
}

/** Whether the one looking may speak, answer and change the members: not while the members say it
 *  is not one of the people. Not known yet: it may (the server refuses what it may not). */
export const mayAct = (m?: Pick<ChannelMembers, "joined">) => m?.joined !== false;

/** 编辑资料's profile of a channel (agent: of its agent there): an agent's is its card, the one its
 *  face opens (["card", "agent:<session>"]), had already. */
export const profileQ = (channel: string, agent?: string) => ({
  queryKey: ["profile", channel, agent ?? ""],
  queryFn: () => (agent ? api.memberCard(`agent:${agent}`).then((c): Profile => c) : (api.channelProfile(channel) as unknown as Promise<Profile>)),
  retry: false,
});
export const memoryQ = (session: string) => ({ queryKey: ["memory", session], queryFn: (): Promise<Memory[]> => api.memory(session), retry: false });

/** What 编辑资料 draws (edit.tsx EditBody), asked before it is pressed: as the card it is a key of
 *  opens, and as that key is pointed at (prefetch.ts useAhead). session: the agent's, or the
 *  session the channel is. */
export function prefetchEdit(qc: QueryClient, channel: string, session?: string, agent?: boolean) {
  const card = agent && session ? qc.getQueryData<Profile>(["card", `agent:${session}`]) : undefined;
  if (card && !qc.getQueryData(profileQ(channel, session).queryKey)) qc.setQueryData(profileQ(channel, session).queryKey, card);
  void qc.prefetchQuery({ ...profileQ(channel, agent ? session : undefined), staleTime: 5_000 });
  if (session) void qc.prefetchQuery({ ...memoryQ(session), staleTime: 5_000 });
  void qc.prefetchQuery({ queryKey: ["roles"], queryFn: api.roles, staleTime: 5_000, retry: false });
  if (agent) void qc.prefetchQuery(hostPersonasQ);
}
