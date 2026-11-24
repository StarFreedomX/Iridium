// A member's menu as a list (docs/前端设计规范.md "一样东西一个实现"): the agent's face's menu
// and its row's submenu among the members are one implementation, the same items in the same
// order. Pure, for tests. And what a channel's page lends the menu wherever it is opened from:
// its composer's @, its way to a session's record.

export type MenuKey = "call" | "compact" | "clear" | "model" | "mode" | "stop" | "recv" | "edit" | "session" | "given" | "remove";

/** The items of an agent's menu, in order. may: the one looking is of the channel's people (else
 *  only what reads); own: the agent is the session the channel is (移出 shown, not offered);
 *  call: the page has a composer to put "@nick" in; models, modes: how many it may pick from (its
 *  effort is the model menu's track, as the composer's: kumo, 2026-11-16); busy: it is at work;
 *  session: its session may be opened from here. */
export function memberMenu(x: { may: boolean; own: boolean; call: boolean; models: number; modes: number; busy: boolean; session: boolean }): { key: MenuKey; disabled?: boolean }[] {
  const out: { key: MenuKey; disabled?: boolean }[] = [];
  const add = (on: boolean, key: MenuKey, disabled?: boolean) => void (on && out.push(disabled ? { key, disabled } : { key }));
  add(x.call, "call");
  add(x.may, "compact");
  add(x.may, "clear");
  add(x.may && x.models > 0, "model");
  add(x.may && x.modes > 1, "mode");
  add(x.may && x.busy, "stop");
  add(x.may, "recv");
  add(x.may, "edit");
  add(x.session, "session");
  add(true, "given");
  add(x.may, "remove", x.own);
  return out;
}

/** What the page of a channel lends: call, "@nick" into its composer; record, a session's record. */
export type ChannelActs = { call?: (nick: string) => void; record?: (session: string) => void };
const acts = new Map<string, ChannelActs>();
/** The page of channel lends these while it is drawn; returns what takes them back. */
export function lendActs(channel: string, a: ChannelActs): () => void {
  acts.set(channel, a);
  return () => void (acts.get(channel) === a && acts.delete(channel));
}
export const actsOf = (channel: string): ChannelActs => acts.get(channel) ?? {};
