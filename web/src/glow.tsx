// A banner with no background of its own (kumo, 2026-11-16: not a grey strip): the face itself,
// drawn large and out of focus behind it, so the banner takes the face's colours. One
// implementation for the profile card and the role card.
import type { ReactNode } from "react";

/** Fills its parent (which is `relative overflow-hidden`) with children, a face, blurred and
 *  enlarged; a light wash over it keeps what stands on the banner readable in both themes. */
export function FaceGlow({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2 scale-[9] place-items-center opacity-90 blur-[5px] saturate-[1.6]">{children}</span>
      <span className="absolute inset-0 bg-linear-to-b from-transparent to-(--paper) opacity-35" />
    </span>
  );
}
