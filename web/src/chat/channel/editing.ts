// 编辑资料 (docs/next/group.md "改资料"): the one page a card is changed on, opened from the
// card, the face's menu, the members' list, the bar's face, ⋯. What is being edited is kept
// here; the chat draws the page over itself (chat.tsx), its code fetched then (edit.tsx).
import { useSyncExternalStore } from "react";

/** channel: the chat it is opened in; agent: the session of the agent whose card it is, none
 *  for the channel's own card. */
export type Editing = { channel: string; agent?: string };

let now: Editing | null = null;
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());

export function openEdit(e: Editing) {
  now = e;
  tell();
}
export function closeEdit() {
  if (!now) return;
  now = null;
  tell();
}
/** What is being edited in channel; null: nothing. */
export function useEditing(channel: string): Editing | null {
  const get = () => (now?.channel === channel ? now : null);
  return useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), get, get);
}
