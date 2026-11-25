// The sidebar on a phone (the user, 2026-11-06): a sheet from the window's foot, half its height,
// over the composer, which stays where it is, covered (it sinks only if taller than the sheet; the
// user, 2026-11-06). Nothing dims: the chat above is seen and scrolls as ever, and a tap on it puts
// the sheet away, as picking a session does. The chat bar's Ir or ⋯ menu brings it out, the Ir
// pressed again puts it away; Esc does too. No swipe brings it or puts it away (kumo, 2026-11-25).
// With no chat open it stays out, the whole window. While searching it stands taller, for the
// keyboard. Its head, the tabs' row with its grip at the right end, dragged up or down sizes it at
// once, no hold first, from LOW up to the window's top, what it holds scrolling, with no bar; it
// stays so on this device. Let go near its first height, it goes back to that.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "./motion";
import { cn, keep, kept } from "./ui";

/** Where a swipe up brings the sheet: the chat's bottom stack (chat.tsx), the composer in it. */
export const PULL = "data-sheet-pull";
/** Its grip's height, px: none now, the grip at its head's end (Grip). */
export const GRIP = 0;
/** How short it may be made, px. */
const LOW = 200;

/** Its grip, at the end of its head's row, right of the keys there (kumo, 2026-11-25: no row of its
 *  own over the head). The head, this with it, dragged up or down sizes the sheet; it lights then. */
export function Grip() {
  return (
    <span aria-hidden className="grid h-8 w-5 shrink-0 cursor-ns-resize place-items-center pointer-coarse:h-10">
      <span className="h-5 w-1 rounded-full bg-fill-2 transition-[height,background-color] duration-(--dur-2) ease-(--ease-out) group-data-sizing/sheet:h-7 group-data-sizing/sheet:bg-ink-3" />
    </span>
  );
}
const HEAD = 64; // px from the sheet's top where a swipe down or a hold may begin: the grip and the head
const KEPT = "sheetH."; // + its name: how tall the user left it, a share of the window
// The sheets sized as one, by name: the sessions' and the 终端 panel share a height (the user,
// 2026-11-07). Each told as one of them is let go.
const told = new Map<string, Set<(g: number) => void>>();
const SNAP = 28; // px from its first height (or the window's top) where, let go, it goes there
// From the conversation: the finger goes DEAD px up before the sheet moves, then the sheet follows
// at RESIST of its pace; let go, it comes out once OPEN of it is out (and the finger went MIN px past
// DEAD at least), or FLICK of it on a quick flick up. A long press first is choosing words: not a swipe.
const LOG = { DEAD: 32, RESIST: 0.7, OPEN: 0.4, FLICK: 0.22, MIN: 160, SPEED: 0.8, HOLD: 400 };
const SETTLED = 120; // ms its height is still before the chat is told it
/** Its first height, but the one as tall as what it holds. */
const FIRST = { half: "max(320px, 50dvh)", tall: "85dvh", full: "100dvh" } as const;
const firstPx = { half: () => Math.max(320, innerHeight / 2), tall: () => innerHeight * 0.85, full: () => innerHeight };

/** Whether a swipe up from x brings the foot's sheet: it began in the window's left quarter. */
export const atLeft = (x: number) => x < innerWidth / 4;

/** size: half the window, most of it, all of it (no chat open: not to be sized), or as tall as what
 *  it holds; made taller or shorter, as the user left it, kept by name. raised: at least most of
 *  the window (searching, for the keyboard). from: where across the window a swipe up may begin to
 *  bring it, told to setOpen as it comes out; onPull: told as a swipe up begins to bring it, where. head: px from its top that are its head, where a swipe
 *  down or a hold may begin, if not HEAD (its grip and the tabs' line, pager.tsx). */
export function Sheet({ open, setOpen, size: want, raised, name, head = 0, from: zone, onPull, label, onHeight, children }: { open: boolean; setOpen: (o: boolean, x?: number) => void; onPull?: (x: number) => void; size: "half" | "tall" | "full" | "fit"; raised?: boolean; name: string; head?: number; from: (x: number) => boolean; label: string; onHeight: (h: number) => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // Going down, it keeps its size till it is down: a chat picked from the whole window's sheet put
  // it away shrinking to half as it went, a second motion over the first (the user, 2026-11-08).
  const [size, setSize] = useState(want);
  if (open && size !== want) setSize(want);
  useEffect(() => {
    if (open || size === want) return;
    const t = setTimeout(() => setSize(want), motion.dur(3) + 40);
    return () => clearTimeout(t);
  }, [open, want, size]);
  // While a finger drags it: how far it is out, 0..1; null when it is not dragged.
  const [drag, setDrag] = useState<number | null>(null);
  // As tall as it was left, a share of the window (0: its first height), and its px while sized.
  const [grown, setGrown] = useState(() => Math.min(1, Number(kept(KEPT + name)) || 0));
  useEffect(() => {
    const all = told.get(name) ?? new Set();
    told.set(name, all);
    all.add(setGrown);
    return () => void all.delete(setGrown);
  }, [name]);
  const [live, setLive] = useState<number | null>(null);
  // Held: the grip lit, the finger sizing it.
  const [armed, setArmed] = useState(false);
  const now = useRef({ open, setOpen, zone, size, name, head, onPull });
  now.current = { open, setOpen, zone, size, name, head, onPull };

  // Its height, for the chat to keep its newest above it: once it is still, not each frame of it
  // growing or of the keyboard moving the window's foot, each a redraw of the whole page.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => onHeight(el.offsetHeight), SETTLED);
    });
    ro.observe(el);
    onHeight(el.offsetHeight);
    return () => (ro.disconnect(), clearTimeout(timer));
  }, []);

  // Made another size out (searching, let go taller), its top glides there by a move alone, not by
  // its height (docs/动画.md: a popup's box is not animated): taller, it is that tall at once, put
  // down by the difference and slid up; shorter, it slides down as tall as it was, and is made
  // shorter once it is there, out of sight under the window's foot. Not as the keyboard changes
  // what dvh is: that would start it again each frame.
  const sizeIs = `${size} ${!!raised} ${live === null ? grown : "drag"}`;
  const [sized, setSized] = useState(sizeIs);
  const glideFrom = useRef<number | null>(null);
  if (sizeIs !== sized) {
    setSized(sizeIs);
    // Where its top is seen now, as px above the window's foot (a glide under way, from there).
    const box = live === null && open ? panel.current?.getBoundingClientRect() : undefined;
    glideFrom.current = box ? innerHeight - box.top : null;
  }
  useLayoutEffect(() => {
    const el = panel.current;
    const from = glideFrom.current;
    glideFrom.current = null;
    if (!el || from === null) return;
    // Kept as tall as it was by min-height, not its height, which is React's (style prop).
    const settle = () => {
      el.style.transition = "none";
      el.style.minHeight = "";
      el.style.translate = "";
      void el.offsetHeight;
      el.style.transition = "";
    };
    settle();
    const d = el.offsetHeight - from;
    if (Math.abs(d) < 1) return;
    el.style.transition = "none";
    if (d < 0) el.style.minHeight = `${from}px`;
    el.style.translate = `0 ${Math.max(0, d)}px`;
    void el.offsetHeight;
    el.style.transition = "";
    el.style.translate = `0 ${Math.max(0, -d)}px`;
    const done = (e: TransitionEvent) => e.target === el && e.propertyName === "translate" && settle();
    el.addEventListener("transitionend", done);
    return () => (el.removeEventListener("transitionend", done), settle());
  }, [sized]);

  useEffect(() => {
    if (!open) return;
    // Out, the keyboard goes: the composer it was for is put away.
    if (document.activeElement instanceof HTMLElement && !panel.current?.contains(document.activeElement)) document.activeElement.blur();
    const key = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=dialog][data-open], [role=menu][data-open]") && setOpen(false);
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [open]);

  // A vertical swipe: up from the composer while shut (its box too while it has nothing to scroll), or
  // from the conversation resting at its newest; down from the grip or the head while out. Undecided
  // till it has moved 8px; then it is the sheet's only if it went more down or up than across, and a
  // way it may go. Held still there first, the finger sizes it instead, up or down.
  useEffect(() => {
    let from: { x: number; y: number; t: number; open: boolean; h: number; log: boolean; box: boolean } | null = null;
    let mine = false;
    let held = false; // the finger sizes it
    let at = 0;
    let tall = 0; // its height as sized, px
    let first = 0; // its first height, px: let go near it, it goes back to it
    let travel = 0; // from the conversation: px the finger went up past LOG.DEAD
    let last = { y: 0, t: 0, v: 0 };
    const height = () => panel.current?.offsetHeight || innerHeight / 2;
    // As tall as what it holds: its grip, its foot and what is in its body.
    const fits = () => {
      const el = panel.current;
      const b = body.current;
      return el && b ? el.offsetHeight - b.clientHeight + ((b.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0) : 0;
    };
    const noSelect = (on: boolean) => {
      const s = document.documentElement.style;
      s.userSelect = on ? "none" : "";
      s.setProperty("-webkit-user-select", on ? "none" : "");
    };
    const noClick = (e: MouseEvent) => (e.stopPropagation(), e.preventDefault());
    const swallowClick = (ms: number) => {
      addEventListener("click", noClick, { capture: true, once: true });
      setTimeout(() => removeEventListener("click", noClick, true), ms);
    };
    // A finger, or a mouse (a computer's window as narrow as a phone's): the head of a sheet that is out.
    const begin = (x: number, y: number, t: number, el: Element | null) => {
      if (!el?.closest) return;
      // No swipe brings it (kumo, 2026-11-25): the bar's Ir, ⋯'s 会话列表. Out, its head dragged up
      // or down sizes it at once, no hold first; put away by a press outside it or the Ir again.
      const { open } = now.current;
      if (!open) return;
      const box = panel.current?.getBoundingClientRect();
      if (!box || !panel.current!.contains(el) || y - box.top > (now.current.head || HEAD) || el.closest("[role=slider], .touch-none, input, textarea")) return;
      if (now.current.size === "full") return;
      from = { x, y, t, open, h: height(), log: false, box: false };
      mine = false;
      held = true;
      last = { y, t, v: 0 };
      const { size } = now.current;
      first = size === "fit" ? fits() : firstPx[size]();
    };
    const start = (e: TouchEvent) => {
      const p = e.touches[0];
      if (e.touches.length !== 1 || !p) return;
      begin(p.clientX, p.clientY, e.timeStamp, e.target as Element | null);
    };
    // Whether it went the sheet's way: then the event is its own (no scroll, no words chosen).
    const step = (x: number, y: number, t: number) => {
      if (!from) return false;
      const dy = y - from.y;
      if (held) {
        // Up or down: the finger sizes it, from LOW up to the window's top; across: the pages'
        // own swipe (pager.tsx). Nothing under it scrolls.
        if (!mine) {
          const dx = Math.abs(x - from.x);
          if (Math.max(Math.abs(dy), dx) < 6) return false;
          if (dx > Math.abs(dy)) {
            from = null;
            return false;
          }
          mine = true;
          setArmed(true);
          noSelect(true);
          getSelection()?.removeAllRanges();
        }
        tall = Math.max(Math.min(LOW, first), Math.min(innerHeight, from.h - dy));
        setLive(tall);
        return true;
      }
      if (!mine) {
        const dx = Math.abs(x - from.x);
        if ((from.log || from.box) && t - from.t > LOG.HOLD) {
          from = null;
          return false;
        }
        if (Math.max(Math.abs(dy), dx) < 8) return false;
          if (Math.abs(dy) < dx * (from.log ? 1.5 : 1.2) || (from.open ? dy < 0 : dy > 0)) {
          from = null;
          return false;
        }
        mine = true;
        // Coming out: what it will show, told before it is seen.
        if (!from.open) now.current.onPull?.(from.x);
      }
      if (from.log) {
        travel = Math.max(0, -dy - LOG.DEAD);
        at = Math.min(1, (travel * LOG.RESIST) / from.h);
      } else at = Math.min(1, Math.max(0, (from.open ? from.h - dy : -dy) / from.h));
      last = { y, t, v: (y - last.y) / Math.max(1, t - last.t) };
      setDrag(at);
      return true;
    };
    const move = (e: TouchEvent) => {
      const p = e.touches[0];
      if (p && step(p.clientX, p.clientY, e.timeStamp) && e.cancelable) e.preventDefault();
    };
    const end = () => {
      if (from && held) {
        // Let go near its first height it goes back to it, near the window's top up to it; else
        // it stays as tall as it was made, on this device.
        if (mine) {
          const g = Math.abs(tall - first) <= SNAP ? 0 : tall >= innerHeight - SNAP ? 1 : tall / innerHeight;
          told.get(now.current.name)?.forEach((f) => f(g));
          keep(KEPT + now.current.name, g ? String(g) : null);
        }
        setLive(null);
        setArmed(false);
        noSelect(false);
        // No tap where it was held and moved; held on a key and let go where it was, the key's.
        if (mine) swallowClick(500);
      } else if (from && mine) {
        // A flick decides by its way; a slow drag by where it was let go: put away once a quarter of
        // it went down.
        const out = from.log
          ? travel >= LOG.MIN && (at >= LOG.OPEN || (at >= LOG.FLICK && last.v < -LOG.SPEED))
          : Math.abs(last.v) > 0.4
            ? last.v < 0
            : at > (from.open ? 0.75 : 0.5);
        now.current.setOpen(out, from.x);
        setDrag(null);
      }
      from = null;
      mine = false;
      held = false;
    };
    // Held on its head: no menu of the page's own; it is the hold if the timer has not been yet.
    const menu = (e: Event) => {
      if (from?.open) e.preventDefault();
    };
    // The mouse: no words chosen while it drags, and no click where it is let go.
    let pressed = false;
    const mdown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      begin(e.clientX, e.clientY, e.timeStamp, e.target as Element | null);
      pressed = !!from;
    };
    const mmove = (e: PointerEvent) => {
      if (!pressed) return;
      if (step(e.clientX, e.clientY, e.timeStamp)) {
        e.preventDefault();
        getSelection()?.removeAllRanges();
        noSelect(true);
      } else if (!from) pressed = false;
    };
    const mup = () => {
      if (!pressed) return;
      pressed = false;
      if (mine && !held) swallowClick(0);
      noSelect(false);
      end();
    };
    addEventListener("touchstart", start, { passive: true });
    addEventListener("touchmove", move, { passive: false });
    addEventListener("touchend", end);
    addEventListener("touchcancel", end);
    addEventListener("contextmenu", menu);
    addEventListener("pointerdown", mdown);
    addEventListener("pointermove", mmove);
    addEventListener("pointerup", mup);
    addEventListener("pointercancel", mup);
    return () => {
      removeEventListener("touchstart", start);
      removeEventListener("touchmove", move);
      removeEventListener("touchend", end);
      removeEventListener("touchcancel", end);
      removeEventListener("contextmenu", menu);
      removeEventListener("pointerdown", mdown);
      removeEventListener("pointermove", mmove);
      removeEventListener("pointerup", mup);
      removeEventListener("pointercancel", mup);
      removeEventListener("click", noClick, true);
      noSelect(false);
    };
  }, []);

  const out = drag ?? (open ? 1 : 0);
  // As tall as it was left, else its first height; searching, at least most of the window.
  const left = grown ? `${grown * 100}dvh` : size === "fit" ? undefined : FIRST[size];
  const height = size === "full" ? FIRST.full : live !== null ? live : raised ? `max(${FIRST.tall}, ${left ?? "0px"})` : left;
  const fixed = size !== "fit" || grown > 0 || live !== null;
  return (
    <div
      ref={panel}
      role="region"
      aria-label={label}
      inert={!open && drag === null}
      className={cn(
        "g-sheet vt-drawer group/sheet fixed inset-x-0 bottom-0 z-40 flex max-h-dvh flex-col overflow-hidden rounded-t-2xl bg-paper pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-float)] [-webkit-touch-callout:none]",
        // Up to the window's top: under the status bar, its corners square.
        (size === "full" || (live === null && grown >= 0.99)) && "rounded-t-none pt-[env(safe-area-inset-top)]",
        drag !== null && "[transition:none]",
        out === 0 && "shadow-none",
      )}
      // Shut, past its own height and its shadow too.
      data-sizing={armed || undefined}
      style={{ transform: `translateY(calc(${(1 - out) * 100}% + ${(1 - out) * 20}px))`, height }}
    >
      {/* What it holds scrolls, with no bar; as tall as it, the one sized to fit. */}
      <div ref={body} className={cn("relative min-h-0", fixed && "flex-1", size === "fit" && "no-bar overflow-y-auto overscroll-contain")}>
        {children}
      </div>
    </div>
  );
}
