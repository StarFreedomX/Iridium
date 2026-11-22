// A channel's receive sets as the page names them (docs/channels.md "接收"): what an agent's set
// (and a script's senders, the same entries) may have, each with its name and face, and a set in
// a few words. The entries: "*" every person, an app's logins ("<app>/*"; an app of one login is
// the app alone, docs/前端设计规范.md "一个登录的应用合成一行"), a login, another agent.
import { UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import type { Recv } from "../../api/types.gen";
import { useApps } from "../../data";
import { t } from "../../i18n";
import { agentName, isHost } from "../../ui";
import { Face, MemberFace } from "./face";
import { useMembers } from "./gate";
import { personName } from "./lib";
import { usePeople } from "./person";
import { recvLabel, recvWhole, type RecvWords } from "./scripts";

export type RecvOption = { entry: string; label: string; face: ReactNode };

export const recvWords = (): RecvWords => ({ at: t("channel.recvAt"), all: t("channel.recvEveryone"), sep: t("channel.what.sep"), n: t("channel.recvCount") });

/** What a receive set of channel may name: every person, its people, its agents but skip (the
 *  agent whose set it is). */
export function useRecvOptions(channel: string, skip?: string): RecvOption[] {
  const members = useMembers(channel);
  const people = usePeople(members);
  const logins = useApps().data?.logins ?? [];
  const out: RecvOption[] = [{ entry: "*", label: t("channel.recvEveryone"), face: <UsersRound size={16} className="shrink-0 text-ink-2" /> }];
  for (const p of people) {
    const app = p.member.slice(0, p.member.indexOf("/"));
    // A login of an app listed whole that has no other: the app's row is it.
    if (!p.member.endsWith("/*") && people.some((x) => x.member === `${app}/*`) && logins.filter((l) => l.app === app).length <= 1) continue;
    out.push({ entry: p.member, label: isHost(p.member) && p.member.endsWith("/*") ? "Iridium" : p.nick, face: <MemberFace member={p.member} name={p.nick} size={16} /> });
  }
  for (const m of members?.members ?? []) {
    if (!m.session || m.session === skip) continue;
    const agent = m.agent ?? "claude";
    out.push({
      entry: m.member,
      label: `@${m.nick || agentName(agent)}`,
      face: (
        <span className="grid size-4 shrink-0 place-items-center rounded-full bg-fill">
          <Face id={m.session} agent={agent} size={16} logo={10} />
        </span>
      ),
    });
  }
  return out;
}

/** An entry of channel's receive sets by name: an agent "@nick", an app, a login. */
export function useRecvName(channel: string): (entry: string) => string {
  const members = useMembers(channel);
  const d = useApps().data;
  const apps = (d?.apps ?? []).map((a) => (a.web ? { ...a, name: t("term.panel") } : a.host && !a.named ? { ...a, name: "Iridium" } : a));
  return (entry) => {
    if (entry === "*") return t("channel.recvEveryone");
    if (entry.startsWith("agent:")) {
      const m = members?.members.find((x) => x.member === entry);
      return `@${m?.nick || (m?.agent ? agentName(m.agent) : entry.slice(6, 14))}`;
    }
    return personName(entry, apps, d?.logins ?? []);
  };
}

/** A receive set in a few words (beside 接收消息), or whole (an event's line). */
export function useRecvLabel(channel: string): { short: (r: Recv) => string; whole: (r: Recv) => string } {
  const name = useRecvName(channel);
  const w = recvWords();
  return { short: (r) => recvLabel(r, name, w), whole: (r) => recvWhole(r, name, w) };
}
