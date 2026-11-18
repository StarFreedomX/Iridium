// Work done away from the channel's folder (the user, 2026-11-18), pure for tests: an agent of a
// channel that runs in another folder, or at another computer, than the channel's does its work
// there; what it says is said in the channel. Which place that is, if any.
import type { Place } from "../places";

/** Where something is: a session's or a channel's row of the list has both. */
export type At = { cwd: string; machine?: string };

/** A path as it is compared: '/'-separated, no slash at its end (the root alone keeps its own). */
const norm = (p: string) => p.replaceAll("\\", "/").replace(/(.)\/+$/, "$1");

/** The place at works in when that is not home, the channel's folder; undefined when it is, or
 *  when either is not known (a row not listed yet: nothing is drawn as away until it is). */
export function awayOf(home: At | undefined, at: At | undefined): Place | undefined {
  if (!home?.cwd || !at?.cwd) return undefined;
  if ((home.machine ?? "") === (at.machine ?? "") && norm(home.cwd) === norm(at.cwd)) return undefined;
  return at.machine ? { machine: at.machine, path: at.cwd } : { path: at.cwd };
}

/** A path's last folder, as the place is named: "/" and a drive alone stay whole. */
export function folderName(path: string): string {
  const p = norm(path);
  return p.slice(p.lastIndexOf("/") + 1) || p;
}
