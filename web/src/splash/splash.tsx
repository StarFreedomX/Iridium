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
import { onPoint, pointedAt, powerNow, stage, stagedNow, STANDARD, type Fig } from "./figure";
import { useHomePicture, useHomeStyle } from "./style";


const MASK = "linear-gradient(to right, transparent, #000 10%, #000 90%, transparent)";

/** show: false, it fades and is gone. fig: what it draws when no row of the + panel is pointed
 *  at; none: Iridium's letters. */
export function Splash({ show = true, fig = null, scene = "", className }: { show?: boolean; fig?: Fig | null; scene?: string; className?: string }) {
  const [there, setThere] = useState(show);
  if (show && !there) setThere(true);
  const pointed = useSyncExternalStore(onPoint, pointedAt);
  const still = useMedia("(prefers-reduced-motion: reduce)");
  const cv = useRef<HTMLCanvasElement>(null);
  const eng = useRef<Engine | null>(null);
  // What the settings ask it to draw (主页): Iridium's letters alone, one's own picture alone, or
  // the faces (the agent pointed at, the channel's own) as they come.
  const style = useHomeStyle();
  const picture = useHomePicture();
  const now = style === "ir" ? null : style === "own" && picture ? { key: `own:${picture.length}:${picture.slice(-24)}`, src: picture } : show ? (pointed ?? fig) : fig;
  const power = useSyncExternalStore(onPoint, powerNow);
  // The portrait layout with the + panel there: the band under the panel, over the composer.
  const phone = useMedia(PHONE);
  const fitRef = useRef(() => {});
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const nowRef = useRef(now);
  nowRef.current = now;
  // Before the frame it is first in: one band going as another comes (the empty pane's, a new
  // channel's) is the same characters with no frame between them.
  useLayoutEffect(() => {
    const el = cv.current;
    if (!el) return;
    const e = splash(el, still, phone);
    eng.current = e;
    e.figure(nowRef.current);
    e.resize();
    // The canvas is the whole pane; the band is the window of it that is seen (engine.ts), over the
    // composer, and stays there whatever opens over it (kumo, 2026-11-25: it is not to move about). The figure in its middle, whole: in the portrait
    // layout as large as the band has room for.
    // The composer's top (a chat's, or the empty pane's box), as far down the canvas as it is.
    const composer = () => el.parentElement?.parentElement?.querySelector<HTMLElement>("[data-sheet-pull]") ?? document.querySelector<HTMLElement>("main [data-sheet-pull]");
    const fit = () => {
      e.resize();
      const w = el.clientWidth, pane = el.clientHeight, ph = phoneRef.current;
      const h = ph ? Math.min(460, Math.max(260, pane * 0.56)) : Math.min(420, Math.max(220, pane * 0.46));
      const box = composer()?.firstElementChild ?? composer();
      const top = box ? box.getBoundingClientRect().top - el.getBoundingClientRect().top : pane - 76;
      // In the portrait layout low in the pane, the figure standing on the composer: the lowest
      // edge of what it draws (Ir's letters' foot) just over the composer's top, as on a line. On a
      // computer in the middle of what is over the composer (kumo, 2026-11-25).
      e.window(ph ? top - h / 2 + 28 : (48 + top) / 2, h);
      e.place(ph ? w / 2 : -1, ph ? Math.min(w * 0.94, h * 0.98) : Math.min(h * 0.92, w * 0.7));
      e.foot(ph ? top - 6 : -1);
    };
    fitRef.current = fit;
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const stack = composer();
    if (stack) ro.observe(stack);
    // Day and night: drawn again in the page's ink as it changes.
    const tone = new MutationObserver(() => requestAnimationFrame(() => e.recolor()));
    tone.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      e.near(ev.clientX - r.left, ev.clientY - r.top);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      ro.disconnect();
      tone.disconnect();
      window.removeEventListener("pointermove", move);
      e.stop();
      eng.current = null;
    };
  }, [there, still, phone]);
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
  useEffect(() => eng.current?.power(show ? power : STANDARD), [power, show]);
  if (!there) return null;
  return (
    <div aria-hidden={!now} className={cn("pointer-events-none absolute inset-0 z-1", className)}>
      <canvas ref={cv} aria-hidden className="absolute inset-0 size-full text-ink" style={{ maskImage: MASK, WebkitMaskImage: MASK }} />
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
  const style = useHomeStyle();
  const mine = open && st?.id === open ? st : null;
  // 主页 无: none drawn at all.
  if (style === "none") return null;
  return <Splash show={!off && (!open || (mine ? mine.show : justMade(open)))} fig={mine?.fig ?? null} scene={open ?? ""} />;
}
