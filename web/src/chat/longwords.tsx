// Words between agents, long (kumo, 2026-11-15: 给人的话不折，agent 之间的话、子代理交回的结果
// 折起): their first lines, fading out at the foot, and a quiet line under them, 还有 N 行, as the
// sidebar's 还有 N 个; pressed, the rest opens in place, its height gliding, and 收起 folds it
// again. Only the words fold: the head over them stays.
import { Ellipsis } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { t, useLang } from "../i18n";
import { motion, reduced } from "../motion";
import { layoutMoves } from "./stick";
import { cn } from "../ui";
import { FOLD_AT, FOLD_SHOW } from "./channel/merge";

/** fold: these are words between agents; lines: how long they are. */
export function LongWords({ fold, lines, children }: { fold: boolean; lines: number; children: ReactNode }) {
  useLang();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  if (!fold || lines <= FOLD_AT) return <>{children}</>;
  const toggle = () => {
    const el = box.current;
    if (!el || reduced()) return setOpen((o) => !o);
    // Its height is its own to draw: the chat only keeps its end under it (stick.tsx).
    layoutMoves(el, motion.dur(2));
    const from = el.offsetHeight;
    flushSync(() => setOpen((o) => !o));
    const to = el.offsetHeight;
    el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: motion.dur(2), easing: motion.ease("out") });
  };
  return (
    <div className="flex min-w-0 flex-col">
      {/* Three of the words' lines (15px type on 23px lines), the last fading out. */}
      <div ref={box} className={cn("min-w-0 overflow-clip", !open && "max-h-[69px] [mask-image:linear-gradient(to_bottom,black_55%,transparent)]")}>
        {children}
      </div>
      <button type="button" onClick={toggle} aria-expanded={open} className="g-press mt-1 flex h-6 w-fit items-center gap-1.5 rounded-md text-xs text-ink-3 hover:text-ink-2 pointer-coarse:h-9">
        <Ellipsis size={13} />
        {open ? t("nav.less") : t("chat.moreLines", { n: lines - FOLD_SHOW })}
      </button>
    </div>
  );
}
