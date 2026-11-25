// The splash (kumo, 2026-11-25): what a channel with nothing said in it yet, and the pane with
// no channel open, show in their middle: a band of small code drawing Iridium's letters, or the
// agent pointed at in the + panel, or the channel's own once it has one (engine.ts). It is
// behind everything and takes no press; it goes as the first message comes.
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Agent } from "../api/types.gen";
import { useFaceSrc } from "../chat/channel/face";
import { t } from "../i18n";
import { cn, useMedia } from "../ui";
import { splash, type Splash as Engine } from "./engine";
import { onPoint, point, pointedAt, type Fig } from "./figure";

const MASK = "linear-gradient(to bottom, transparent, #000 24%, #000 76%, transparent), linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)";

/** show: false, it fades and is gone. fig: what it draws when no row of the + panel is pointed
 *  at; none: Iridium's letters. */
export function Splash({ show = true, fig = null, className }: { show?: boolean; fig?: Fig | null; className?: string }) {
  const [there, setThere] = useState(show);
  if (show && !there) setThere(true);
  const pointed = useSyncExternalStore(onPoint, pointedAt);
  const still = useMedia("(prefers-reduced-motion: reduce)");
  const cv = useRef<HTMLCanvasElement>(null);
  const eng = useRef<Engine | null>(null);
  // Back pressed (the key left of a figure; for now, kumo, 2026-11-25): Iridium's letters again,
  // until another figure is asked for.
  const asked = show ? (pointed ?? fig) : fig;
  const [left, setLeft] = useState<string | null>(null);
  const now = asked && asked.key === left ? null : asked;
  const [side, setSide] = useState(0);
  const nowRef = useRef(now);
  nowRef.current = now;
  useEffect(() => {
    const el = cv.current;
    if (!el) return;
    const e = splash(el, still);
    eng.current = e;
    e.figure(nowRef.current);
    e.resize();
    const fit = () => (e.resize(), setSide(Math.min(el.clientHeight * 0.92, el.clientWidth * 0.7)));
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
  if (!there) return null;
  return (
    <div aria-hidden={!now} onTransitionEnd={(e) => e.target === e.currentTarget && !show && setThere(false)} className={cn("pointer-events-none absolute inset-x-0 top-[calc(50%-24px)] z-1 h-[clamp(220px,46%,420px)] -translate-y-1/2 transition-opacity duration-(--dur-3) ease-(--ease-out)", !show && "opacity-0", className)}>
      <canvas ref={cv} aria-hidden className="absolute inset-0 size-full text-ink" style={{ maskImage: MASK, maskComposite: "intersect", WebkitMaskImage: MASK, WebkitMaskComposite: "source-in" }} />
      {now && show && side > 0 && (
        <button type="button" aria-label={t("nav.back")} onClick={() => (setLeft(now.key), point(null))} style={{ left: `max(8px, calc(50% - ${Math.round(side / 2) + 44}px))` }} className="g-fade g-press pointer-events-auto absolute top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-fill hover:text-ink pointer-coarse:size-10">
          <ChevronLeft size={17} />
        </button>
      )}
    </div>
  );
}

/** A channel's: its own face, or its last agent's, or that one's mark; no agent yet: Iridium's
 *  letters. */
export function ChannelSplash({ id, show, last }: { id: string; show: boolean; last?: { session: string; agent: Agent } }) {
  const own = useFaceSrc(id, true);
  const src = useFaceSrc(last?.session ?? id);
  return <Splash show={show} fig={last ? { key: `c:${id}:${own}:${src}`, src: own || src || undefined, alt: own && src ? src : undefined, agent: last.agent } : null} />;
}
