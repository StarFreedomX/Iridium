// Rows of the app's own pages that come and go fold open and shut, never jump (docs/前端设计规范.md
// "出现、消失都要动画"): kumo, 2026-11-22, the list jumped as this computer's row came in.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../ui";

export type Shown<T> = { item: T; key: string; state: "in" | "new" | "out" };

/** items as drawn: those there at the first draw just are; those after fold open; those taken
 *  away stay, folding shut, then go. */
export function useFolding<T>(
  items: T[] | null,
  key: (t: T) => string,
): Shown<T>[] {
  const [shown, setShown] = useState<Shown<T>[]>([]);
  const drawn = useRef(false);
  useEffect(() => {
    if (items === null) return;
    const first = !drawn.current;
    drawn.current = true;
    setShown((prev) => {
      const keys = new Set(items.map(key));
      const had = new Set(
        prev.filter((p) => p.state !== "out").map((p) => p.key),
      );
      const next: Shown<T>[] = items.map((item) => {
        const k = key(item);
        return { item, key: k, state: first || had.has(k) ? "in" : "new" };
      });
      // The ones gone, at their places, folding shut.
      prev.forEach((p, i) => {
        if (!keys.has(p.key))
          next.splice(Math.min(i, next.length), 0, { ...p, state: "out" });
      });
      return next;
    });
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  // Those folded shut go once the fold is done.
  useEffect(() => {
    if (!shown.some((s) => s.state === "out")) return;
    const t = setTimeout(
      () => setShown((s) => s.filter((x) => x.state !== "out")),
      400,
    );
    return () => clearTimeout(t);
  }, [shown]);
  return shown;
}

/** One row folding: open when "in", opening when "new", shutting when "out" (or hidden). */
export function Fold({
  state,
  children,
}: {
  state: "in" | "new" | "out";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(state === "in");
  useEffect(() => {
    if (state === "out") return setOpen(false);
    if (open) return;
    let r = requestAnimationFrame(
      () => (r = requestAnimationFrame(() => setOpen(true))),
    );
    return () => cancelAnimationFrame(r);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      aria-hidden={state === "out" || undefined}
      inert={state === "out" || undefined}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-(--dur-3) ease-(--ease-out)",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
