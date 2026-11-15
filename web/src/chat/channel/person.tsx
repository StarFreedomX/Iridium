// A person's card in a channel (the user, 2026-11-13: people, apps and agents are peers): their
// face pressed opens it, as an agent's does (members.tsx Card). Their face and name; 私聊, the
// channel of the two of you (POST /v1/internal/dm), for a login or the host only (an app, an
// author that is no login have none: the owner, 2026-11-14); and 提及, "@name" in the composer.
import { AtSign, MessageCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import type { ChannelMembers } from "../../api/types.gen";
import { t } from "../../i18n";
import { openChat } from "../../route";
import { isComputer, useApps } from "../../data";
import { errText, toast } from "../../toast";
import { Avatar, cn, isHost } from "../../ui";
import { mayDM, userOf, type AgentRow } from "./lib";
import { AgentCard } from "./members";
import { namesOf, type Named } from "./nick";
import { hasApp, hasLogin, peopleOf } from "./setup";

const KEY = "g-press flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-fill px-2 text-sm text-ink hover:bg-fill-2 disabled:opacity-50 pointer-coarse:h-10";

/** user: their Satori user id (a login's, "local" the host's); app: the app they came by. dm:
 *  false for the one looking (no channel of one). */
export function PersonCard({ user, name, avatar, app, call, dm: other = true }: { user: string; name: string; avatar?: string; app?: string; call?: (name: string) => void; dm?: boolean }) {
  const [busy, setBusy] = useState(false);
  const dm = mayDM(user, useApps().data?.logins ?? []) && other;
  const talk = () => {
    setBusy(true);
    void api.dm(user).then(
      (r) => openChat(r.channel),
      (e) => (setBusy(false), toast(t("err.action"), { error: true, description: errText(e) })),
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar src={avatar} name={name} size={48} host={isHost(user)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold">{name}</span>
          {app && <span className="truncate text-xs text-ink-3">{app}</span>}
        </div>
      </div>
      {(dm || call) && <div className="flex gap-1.5">
        {dm && (
          <button type="button" disabled={busy} onClick={talk} className={KEY}>
            <MessageCircle size={14} className="shrink-0" />
            <span className="truncate">{t("channel.dm")}</span>
          </button>
        )}
        {call && (
          <button type="button" onClick={() => call(name)} className={cn(KEY)}>
            <AtSign size={14} className="shrink-0" />
            <span className="truncate">{t("channel.call")}</span>
          </button>
        )}
      </div>}
    </div>
  );
}

/** A channel's people and apps as an @ names them (peers of its agents): each login among its
 *  people, each app whose all are; no computer (not invited, the owner, 2026-11-14). */
export function usePeople(members?: ChannelMembers): AgentRow[] {
  const apps = useApps().data;
  return useMemo(() => {
    const ps = peopleOf(members);
    const out: AgentRow[] = [];
    for (const a of apps?.apps ?? []) {
      if (isComputer(a)) continue;
      const appName = a.web ? t("term.panel") : a.name;
      if (hasApp(ps, a.id)) out.push({ session: "", member: `${a.id}/*`, agent: "" as AgentRow["agent"], nick: appName, name: t("channel.app"), status: "idle", recv: "", avatar: a.avatar, person: true });
      for (const l of (apps?.logins ?? []).filter((x) => x.app === a.id)) {
        if (hasLogin(ps, a.id, l.id)) out.push({ session: "", member: `${a.id}/${l.id}`, agent: "" as AgentRow["agent"], nick: l.name, name: appName, status: "idle", recv: "", avatar: l.avatar, person: true });
      }
    }
    return out;
  }, [apps, members]);
}

/** A channel's members as its words name them (nick.tsx Nicks) and as its composer's @ lists
 *  them: named, for the words (the one looking among them: others name it); others, the people
 *  and apps but the one looking, for the @ list. Pressed in the words, a member's card: the one
 *  its face opens. call: "@name" into the composer; record, talk: as an agent's face takes them. */
export function useNamed({ channel, agents, members, may, call, record, talk }: { channel: string; agents: AgentRow[]; members?: ChannelMembers; may: boolean; call: (name: string) => void; record?: (session: string) => void; talk?: () => void }): { named: Named; others: AgentRow[] } {
  const people = usePeople(members);
  const me = members?.me;
  // As they are now, for a card opened later.
  const fns = useRef({ call, record, talk });
  fns.current = { call, record, talk };
  const sig = agents.map((a) => `${a.session}:${a.nick}:${a.name}:${a.status}:${a.agent}`).join(" ");
  const named = useMemo<Named>(
    () => ({
      agents,
      people,
      names: namesOf(agents, people),
      card: (m, done) => {
        const name = (n: string) => (done(), fns.current.call(n));
        if (m.person) return <PersonCard user={userOf(m.member)} name={m.nick} avatar={m.avatar} app={m.name} dm={m.member !== me} call={may ? name : undefined} />;
        return <AgentCard channel={channel} a={m} call={may ? name : undefined} record={fns.current.record && ((x) => fns.current.record?.(x))} may={may} talk={fns.current.talk && (() => fns.current.talk?.())} done={done} />;
      },
    }),
    [channel, sig, people, may, me],
  );
  const others = useMemo(() => people.filter((p) => p.member !== me), [people, me]);
  return { named, others };
}
