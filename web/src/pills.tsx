// A small switch of words or marks (usage.tsx, device/page.tsx); not in the first screen.
import type { ReactNode } from "react";
import { cn, Tip } from "./ui";

/** A small switch: words, or marks with their names as tips, the one chosen on a lighter pill
 *  inside a soft one. */
export function Pills<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: ReactNode }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-full bg-fill p-0.5">
      {options.map((o) => {
        const key = (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            aria-label={o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              "g-press grid h-5 place-items-center rounded-full text-[11px] transition-colors duration-(--dur-2) pointer-coarse:h-7",
              o.icon ? "w-6 pointer-coarse:w-8" : "px-2.5",
              o.value === value ? "bg-fill-2 font-medium text-ink" : "text-ink-3 hover:text-ink",
            )}
          >
            {o.icon ?? o.label}
          </button>
        );
        return o.icon ? (
          <Tip key={o.value} label={o.label}>
            {key}
          </Tip>
        ) : (
          key
        );
      })}
    </div>
  );
}
