// A channel's people as its members' list and the new session's page edit them
// (docs/channels.md), pure for tests: member strings ("*" everyone, "<app>/*" all of an app's
// logins, "<app>/<login>").
import type { ChannelMembers } from "../../api/types.gen";

export const EVERYONE = "*";
export const appAll = (app: string) => `${app}/*`;
export const loginOf = (app: string, login: string) => `${app}/${login}`;

/** Whether the people are everyone: none named, or "*" among them. */
export const everyone = (people: string[]) => !people.length || people.includes(EVERYONE);

/** A channel's people as its members say them: those that are no agent's. */
export const peopleOf = (m?: Pick<ChannelMembers, "members">) => (m?.members ?? []).filter((x) => !x.session && !x.member.startsWith("agent:")).map((x) => x.member);

/** Whether login of app is among people: named, or its app's all are. */
export const hasLogin = (people: string[], app: string, login: string) => everyone(people) || people.includes(appAll(app)) || people.includes(loginOf(app, login));
/** Whether all of app's logins are among people. */
export const hasApp = (people: string[], app: string) => everyone(people) || people.includes(appAll(app));

/** people with me kept among them (unless everyone is, or me's app's all are). */
export function keepMe(people: string[], me?: string): string[] {
  if (!me || everyone(people) || people.includes(me) || people.includes(appAll(me.slice(0, me.indexOf("/"))))) return people;
  return [...people, me];
}

/** An app's all turned on or off: on, its single logins go (they are among its all); off, none of
 *  the app's stay but me. */
export function setApp(people: string[], app: string, on: boolean, me?: string): string[] {
  const rest = people.filter((p) => p !== EVERYONE && p !== appAll(app) && !p.startsWith(`${app}/`));
  return keepMe(on ? [...rest, appAll(app)] : rest, me);
}

/** A login turned on or off. logins: its app's logins, by id: turned off while its app's all are
 *  in, the others are named one by one. me is never turned off. */
export function setLogin(people: string[], app: string, login: string, on: boolean, logins: string[], me?: string): string[] {
  const it = loginOf(app, login);
  if (!on && it === me) return people;
  let next = people.filter((p) => p !== EVERYONE && p !== it);
  if (on) next = next.includes(appAll(app)) ? next : [...next, it];
  else if (next.includes(appAll(app))) next = [...next.filter((p) => p !== appAll(app)), ...logins.filter((l) => l !== login).map((l) => loginOf(app, l))];
  return keepMe(next, me);
}

/** people with everyone spelled out: each listed app's all. */
const spelled = (people: string[], apps: string[]) => (everyone(people) ? apps.map(appAll) : people);
/** people as few as they say: an app whose logins are all named, its all; every listed app's
 *  all, everyone. */
function gathered(people: string[], apps: string[], loginsOf: (app: string) => string[]): string[] {
  let out = people;
  for (const a of apps) {
    const ls = loginsOf(a);
    if (ls.length && !out.includes(appAll(a)) && ls.every((l) => out.includes(loginOf(a, l)))) out = [...out.filter((p) => !p.startsWith(`${a}/`)), appAll(a)];
  }
  return apps.length && apps.every((a) => out.includes(appAll(a))) ? [EVERYONE] : out;
}

/** A login's chip pressed (the new session's people, lit or not): everyone is each app's all
 *  first, and all lit is everyone again. apps: those listed; loginsOf: an app's logins, by id. */
export const pressLogin = (people: string[], apps: string[], loginsOf: (app: string) => string[], app: string, login: string, me?: string) =>
  gathered(setLogin(spelled(people, apps), app, login, !hasLogin(people, app, login), loginsOf(app), me), apps, loginsOf);

/** An app's 全选 pressed: all its logins in, or (all in already) none but me. */
export const pressApp = (people: string[], apps: string[], loginsOf: (app: string) => string[], app: string, me?: string) =>
  gathered(setApp(spelled(people, apps), app, !hasApp(people, app), me), apps, loginsOf);
