// What the 缓存 page shows (device/page.tsx): the usage by kind and the rules, read ahead (at
// start, after the sweep; as its row is pointed at or pressed) so the page is whole as it opens.
import { useSyncExternalStore } from "react";
import { keepChats } from "./first";
import { clear, entries, getConf, setConf, sweep, usageOf, type Cat, type Conf, type Usage } from "./store";

export interface DeviceState {
  usage: Usage;
  conf: Conf;
}
let snap: DeviceState | null = null;
const subs = new Set<() => void>();
let reading: Promise<void> | null = null;

/** Reads it all again. */
export function refresh(): Promise<void> {
  return (reading ??= Promise.all([entries(), getConf()])
    .then(([es, conf]) => {
      snap = { usage: usageOf(es), conf };
      subs.forEach((f) => f());
    })
    .catch(() => {})
    .finally(() => (reading = null)));
}
/** Reads it ahead (what was kept since is counted). */
export const ahead = () => void refresh();

export function useDevice(): DeviceState | null {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => snap,
    () => snap,
  );
}

/** Lets go of kind cat, the page's numbers after. */
export async function clearCat(cat: Cat) {
  await clear(cat).catch(() => {});
  await refresh();
}

/** New rules, swept by at once; the chats not kept let go. */
export async function changeConf(c: Conf) {
  if (snap) {
    snap = { ...snap, conf: c };
    subs.forEach((f) => f());
  }
  await setConf(c).catch(() => {});
  keepChats(c.chats);
  if (!c.chats) await clear("chat").catch(() => {});
  await sweep().catch(() => {});
  await refresh();
}

/** A size as the page writes it: 64 KB, 12.5 MB. */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
