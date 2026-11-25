// The splash (kumo, 2026-11-25): what a channel with nothing said in it yet, and the pane with
// no channel open, show in their middle: a band of small code drawing Iridium's letters, or the
// agent pointed at in the + panel, or the channel's own once it has one (engine.ts). It is
// behind everything and takes no press; it goes as the first message comes.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Agent } from "../api/types.gen";
import { useFaceSrc } from "../chat/channel/face";
import { cn, PHONE, useMedia } from "../ui";
import { splash, type Splash as Engine } from "./engine";
import { justMade } from "../chat/channel/adding";
import { onPoint, panelIsUp, panelOpen, pointedAt, powerNow, stage, stagedNow, STANDARD, type Fig } from "./figure";

// The + panel and the menu beside its rows, with the gaps about them: what the figure keeps left of.
const PANEL = 660;

const MASK = "linear-gradient(to bottom, transparent, #000 24%, #000 76%, transparent), linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)";

/** show: false, it fades and is gone. fig: what it draws when no row of the + panel is pointed
 *  at; none: Iridium's letters. */
export function Splash({ show = true, fig = null, scene = "", className }: { show?: boolean; fig?: Fig | null; scene?: string; className?: string }) {
  const [there, setThere] = useState(show);
  if (show && !there) setThere(true);
  const pointed = useSyncExternalStore(onPoint, pointedAt);
  const still = useMedia("(prefers-reduced-motion: reduce)");
  const cv = useRef<HTMLCanvasElement>(null);
  const eng = useRef<Engine | null>(null);
  const now = show ? (pointed ?? fig) : fig;
  const aside = useSyncExternalStore(onPoint, panelOpen) && show;
  const asideRef = useRef(aside);
  asideRef.current = aside;
  const power = useSyncExternalStore(onPoint, powerNow);
  // The portrait layout with the + panel there: the band under the panel, over the composer.
  const phone = useMedia(PHONE);
  const up = useSyncExternalStore(onPoint, panelIsUp);
  const low = phone && up && show;
  // Where it is drawn goes after where it is to be: the characters go out where they are, the
  // band is put at its other place with none drawn, and they come in there (kumo, 2026-11-25: it
  // was down in one frame as the + was pressed).
  const [placed, setPlaced] = useState(low);
  const comeIn = useRef(false);
  const fitRef = useRef(() => {});
  const nowRef = useRef(now);
  nowRef.current = now;
  // Before the frame it is first in: one band going as another comes (the empty pane's, a new
  // channel's) is the same characters with no frame between them.
  useLayoutEffect(() => {
    const el = cv.current;
    if (!el) return;
    const e = splash(el, still);
    eng.current = e;
    e.figure(nowRef.current);
    e.resize();
    // Left of the panel while it is open and there is room for a figure there; else the middle.
    const fit = () => {
      e.resize();
      if (comeIn.current) (comeIn.current = false), e.enter();
      const w = el.clientWidth, h = el.clientHeight, free = w - PANEL;
      const left = asideRef.current && free >= 240;
      const side = left ? Math.min(h * 0.92, free * 0.9) : Math.min(h * 0.92, w * 0.7);
      e.place(left ? free / 2 : -1, side);
    };
    fitRef.current = fit;
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      e.near(ev.clientX - r.left, ev.clientY - r.top);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("pointermove", move);
      e.stop();
      eng.current = null;
    };
  }, [there, still]);
  useEffect(() => eng.current?.figure(now), [now?.key]);
  // Not to be shown any more: where it was shown (the same channel, its first agent in or its
  // first words said), it goes by its own going, played whole; the page under it another one,
  // it is gone with the page it was of.
  const shownAt = useRef(scene);
  if (show) shownAt.current = scene;
  useLayoutEffect(() => {
    if (!there) return;
    if (show) eng.current?.enter();
    else if (shownAt.current !== scene || !eng.current) setThere(false);
    else eng.current.leave(() => setThere(false));
  }, [show, scene, there]);
  useEffect(() => fitRef.current(), [aside]);
  useEffect(() => {
    if (low === placed) return;
    const e = eng.current;
    if (!e || still) return setPlaced(low);
    e.leave(() => ((comeIn.current = true), setPlaced(low)));
  }, [low, placed, still]);
  // Put there: come in, once its size there is known (fit), or now if it is the same size.
  useEffect(() => {
    const id = requestAnimationFrame(() => comeIn.current && fitRef.current());
    return () => cancelAnimationFrame(id);
  }, [placed]);
  useEffect(() => eng.current?.power(show ? power : STANDARD), [power, show]);
  if (!there) return null;
  return (
    <div aria-hidden={!now} className={cn("pointer-events-none absolute inset-x-0 z-1", placed ? "top-[calc(100%-84px)] h-[max(120px,calc(50%-150px))] -translate-y-full" : "top-[calc(50%-24px)] h-[clamp(220px,46%,420px)] -translate-y-1/2", className)}>
      <canvas ref={cv} aria-hidden className="absolute inset-0 size-full text-ink" style={{ maskImage: MASK, maskComposite: "intersect", WebkitMaskImage: MASK, WebkitMaskComposite: "source-in" }} />
    </div>
  );
}

/** A channel says what the pane's splash is to show for it: whether nothing is said in it yet,
 *  and its figure: its own face, or its last agent's, or that one's mark; no agent yet:
 *  Iridium's letters. Draws nothing itself. */
export function ChannelSplash({ id, show: blank, last, agents }: { id: string; show: boolean; last?: { session: string; agent: Agent }; agents: number }) {
  const own = useFaceSrc(id, true);
  const src = useFaceSrc(last?.session ?? id);
  const key = last ? `c:${id}:${own}:${src}` : "";
  // Its first agent come while it is looked at: the splash turns to that one's face, stays a
  // moment, and goes (kumo, 2026-11-25: an agent takes its time to start; the going is played
  // whole meanwhile). One come to with agents and nothing said keeps its splash till words come.
  const none = useRef(agents === 0);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!none.current || agents === 0) return;
    const timer = setTimeout(() => setOver(true), 2400);
    return () => clearTimeout(timer);
  }, [agents > 0]);
  const show = blank && !over;
  useLayoutEffect(() => stage({ id, show, fig: last ? { key, src: own || src || undefined, alt: own && src ? src : undefined, agent: last.agent } : null }), [id, show, key]);
  return null;
}

/** The pane's one splash: there with no channel open (open: none) and in a channel that says
 *  nothing is said in it yet; one just made is taken so before it says. off: a page that has
 *  none (a session's record). */
export function PaneSplash({ open, off }: { open?: string; off?: boolean }) {
  const st = useSyncExternalStore(onPoint, stagedNow);
  const mine = open && st?.id === open ? st : null;
  return <Splash show={!off && (!open || (mine ? mine.show : justMade(open)))} fig={mine?.fig ?? null} scene={open ?? ""} />;
}
