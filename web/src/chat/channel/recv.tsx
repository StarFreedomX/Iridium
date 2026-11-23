// The senders a channel's subscriptions may name (docs/channels.md "订阅事件"), each with its name
// and face, and an agent's subscriptions in a few words. The entries: "*" every person, an app's logins ("<app>/*"; an app of one login is
// the app alone, docs/前端设计规范.md "一个登录的应用合成一行"), a login, another agent.
import { UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import type { Trigger } from "../../api/types.gen";
import { useApps } from "../../data";
import { t } from "../../i18n";
import { agentName, isHost } from "../../ui";
import { Face, MemberFace } from "./face";
import { useMembers } from "./gate";
import { personName } from "./lib";
import { usePeople } from "./person";
import { EVENTS, onLabel, recvWhole, triggerLine, type CronWords, type RecvWords, type TriggerWords } from "./scripts";

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

/** An agent's subscriptions in a few words (beside 订阅事件), or whole (an event's line); an older
 *  line's receive set whole. */
export function useRecvLabel(channel: string): { short: (on: Trigger[]) => string; whole: (r: string[]) => string; onWhole: (on: Trigger[]) => string } {
  const name = useRecvName(channel);
  const w = recvWords();
  const tw = triggerWords();
  return { short: (on) => onLabel(on, name, w), whole: (r) => recvWhole(r, name, w), onWhole: (on) => (on.length ? [w.at, ...on.map((x) => triggerLine(x, name, tw))].join(tw.sep) : w.at) };
}

/** The words a trigger is said in, in the page's language. */
export function triggerWords(): TriggerWords {
  return {
    message: t("script.line.message"),
    messageHas: t("script.line.messageHas"),
    quote: t("script.line.quote"),
    or: t("script.line.or"),
    anyone: t("script.line.anyone"),
    command: t("script.line.command"),
    cron: t("script.line.cron"),
    event: t("script.line.event"),
    events: Object.fromEntries(EVENTS.map((e) => [e, t(`script.ev.${e}`)])),
    sep: t("channel.what.sep"),
    textSep: t("script.line.textSep"),
    recv: { all: t("channel.recvEveryone") },
    when: cronWords(),
  };
}
export const cronWords = (): CronWords => ({ minute: t("cron.minute"), everyMin: t("cron.everyMin"), hourly: t("cron.hourly"), everyHour: t("cron.everyHour"), daily: t("cron.daily"), weekdays: t("cron.weekdays"), weekly: t("cron.weekly"), monthly: t("cron.monthly"), days: t("cron.days").split(","), sep: t("channel.what.sep") });
