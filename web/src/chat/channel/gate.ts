// A channel's members as the page asks for them (docs/channels.md), apart from what draws them:
// a chat needs them to know whether the one looking is of its people.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "../../api/client";
import type { ChannelMembers } from "../../api/types.gen";
import { useCarried } from "../../store";

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
  return q.data as ChannelMembers | undefined;
}

/** Whether the one looking may speak, answer and change the members: not while the members say it
 *  is not one of the people. Not known yet: it may (the server refuses what it may not). */
export const mayAct = (m?: Pick<ChannelMembers, "joined">) => m?.joined !== false;
