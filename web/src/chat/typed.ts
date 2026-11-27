// Words being written, typed out (kumo, 2026-11-25: 它先人出来，然后再打字): the server tells a
// message being written at most every 120ms, a piece of words each time; drawn as it came, a line
// or two would show at once. What came since is let out a little each frame instead, as fast as
// the words have been coming, faster when behind, so the newest line is the one being typed. What
// was there as it was first drawn shows at once; with reduced motion all of it does.
import { useEffect, useRef, useState } from "react";
import { reduced } from "../motion";

/** How far behind it may fall: what is left is let out over at most this long. */
const BEHIND = 300;

/** The part of text shown now; live: words still come (once whole, what is left is let out as
 *  quickly, then all of it is shown). */
export function useTyped(text: string, live: boolean): string {
  const [, draw] = useState(0);
  const s = useRef({ n: text.length, text, rate: 0, came: 0, frame: 0, last: 0, live }).current;
  s.live = live;
  // Not a growth of what was shown (written over, cut): from where they still agree.
  if (!text.startsWith(s.text.slice(0, s.n))) s.n = Math.min(s.n, text.length);
  if (text !== s.text) {
    const now = performance.now();
    const more = text.length - s.text.length;
    // How fast the words come, kept as they do.
    if (more > 0 && s.came) s.rate = s.rate ? s.rate * 0.7 + (more / Math.max(16, now - s.came)) * 0.3 : more / Math.max(16, now - s.came);
    s.came = now;
    s.text = text;
  }
  if (reduced()) s.n = text.length;
  useEffect(() => {
    if (s.n >= s.text.length || s.frame) return;
    s.last = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = Math.min(50, now - s.last);
      s.last = now;
      const left = s.text.length - s.n;
      const per = Math.max(s.rate, left / BEHIND, s.live ? 0 : left / 120);
      let n = Math.min(s.text.length, s.n + Math.max(1, Math.round(per * dt)));
      // Never half of a letter made of two (an emoji, a rare Chinese character).
      const c = s.text.charCodeAt(n - 1);
      if (c >= 0xd800 && c <= 0xdbff && n < s.text.length) n++;
      s.n = n;
      draw((x) => x + 1);
      s.frame = s.n < s.text.length ? requestAnimationFrame(step) : 0;
    };
    s.frame = requestAnimationFrame(step);
  });
  useEffect(() => () => cancelAnimationFrame(s.frame), []);
  return s.n >= text.length ? text : text.slice(0, s.n);
}
