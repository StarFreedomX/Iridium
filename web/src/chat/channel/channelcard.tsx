// The card the title's face opens (docs/前端设计规范.md "点头像弹卡，不换页"; kumo, 2026-11-16):
// a popover out of the face, never a page. A session's own channel: its agent's card (the one
// card, members.tsx AgentCard); a channel with no agent of its own: its name, intro, background.
// 编辑资料 is a key of the card, the card turning into it in place (edit.tsx), for one of its
// people.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PencilLine } from "lucide-react";
import { api } from "../../api/client";
import type { Agent, Profile } from "../../api/types.gen";
import { t, useLang } from "../../i18n";
import { useList } from "../../store";
import { agentName, lampOf, titleOf } from "../../ui";
import { EditBody } from "./edit";
import { Face } from "./face";
import { mayAct, useMembers } from "./gate";
import type { AgentRow } from "./lib";
import { AgentCard } from "./members";
import { ProfileCard, type CardKey } from "./profilecard";

/** The card of channel id, inside the popover at its face; done puts the popover away. */
export function ChannelCard({ id, agent, done }: { id: string; agent: Agent; done: () => void }) {
  useLang();
  const members = useMembers(id);
  const may = mayAct(members);
  const row = useList()?.find((x) => x.id === id);
  const own = members?.members.find((m) => m.session === id);
  const [edit, setEdit] = useState(false);
  // Asked as 编辑资料 asks (one query): what it shows is what is being changed there.
  const q = useQuery({ queryKey: ["profile", id, ""], queryFn: () => api.channelProfile(id) as unknown as Promise<Profile>, staleTime: 5_000, retry: false, enabled: !own });
  if (own && row) {
    const kind = own.agent ?? row.agent;
    const a: AgentRow = { session: id, member: own.member, agent: kind, nick: own.nick ?? "", name: own.name ?? agentName(kind), status: lampOf(row), recv: own.recv ?? "all" };
    return <AgentCard channel={id} a={a} may={may} done={done} />;
  }
  if (edit) return <EditBody editing={{ channel: id }} back={() => setEdit(false)} done={done} />;
  const p = q.data;
  const keys: CardKey[] = may ? [{ icon: <PencilLine size={14} />, label: t("profile.edit"), run: () => setEdit(true) }] : [];
  return (
    <ProfileCard
      face={
        <span className="grid size-14 place-items-center rounded-full bg-fill">
          <Face id={id} agent={agent} size={56} logo={30} />
        </span>
      }
      name={p?.name || (row ? titleOf(row) : "")}
      intro={p?.intro}
      background={p?.background}
      keys={keys}
    />
  );
}
