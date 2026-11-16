// The card a face or an @name opens (docs/next/group.md "资料卡"; the user, 2026-11-16): one
// for people, agents and apps. A banner (its background; a flat ground with none), the face on
// the banner's lower edge, then what it is called, what it runs as and its state, its intro (a
// person's signature), its keys.
import { FaceGlow } from "../../glow";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../../api/client";
import { useCarried } from "../../store";
import { cn } from "../../ui";

/** The popover a card is in: no padding of its own (the banner goes edge to edge). */
export const CARD_POP = "w-[min(320px,calc(100vw-16px))] overflow-hidden p-0";

/** A member's card as the daemon has it (GET members/{who}): asked again as any card changes
 *  (the carried "cards"). who: an agent's "agent:<session>", a person's login or app id. */
export function useCard(who: string) {
  // Again as any card changes (its name, intro, face): "cards", not only "avatars".
  const seq = useCarried<number>("cards");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["card", who], queryFn: () => api.memberCard(who), staleTime: 5_000, retry: false, enabled: !!who });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    void qc.invalidateQueries({ queryKey: ["card", who] });
  }, [seq, who, qc]);
  return q.data;
}

/** A key of the card. */
export type CardKey = { icon: ReactNode; label: string; run: () => void; disabled?: boolean };

/** face: 56 across, round. sub: the line under the name (what an agent runs as, a person's
 *  app); state: the line after it (an agent's lamp and state). */
export function ProfileCard({ face, name, sub, state, intro, background, keys }: { face: ReactNode; name: string; sub?: ReactNode; state?: ReactNode; intro?: string; background?: string; keys: CardKey[] }) {
  const [gone, setGone] = useState<string | null>(null);
  const banner = background && gone !== background ? background : undefined;
  return (
    <div className="flex flex-col">
      <div className="relative h-[76px] shrink-0 overflow-hidden bg-fill-2">
        {!banner && <FaceGlow>{face}</FaceGlow>}
        {banner && <img src={banner} alt="" draggable={false} onError={() => setGone(banner)} className="g-fade absolute inset-0 size-full object-cover" />}
      </div>
      <div className="flex flex-col px-3.5 pb-3.5">
        {/* On the banner's lower edge, ringed in the card's ground. */}
        <span className="relative -mt-8 grid size-[62px] shrink-0 place-items-center rounded-full bg-paper shadow-[0_1px_3px_var(--edge)]">{face}</span>
        <span className="mt-2 text-md leading-6 font-semibold [overflow-wrap:anywhere]">{name}</span>
        {(sub || state) && (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs leading-5 text-ink-3">
            {sub && <span className="min-w-0 truncate">{sub}</span>}
            {state && <span className="flex shrink-0 items-center gap-1.5">{state}</span>}
          </span>
        )}
        {/* What comes after the card is shown (a person's signature) slides open, pushing nothing at once. */}
        <div className={cn("grid transition-[grid-template-rows,opacity] duration-(--dur-3) ease-(--ease-out)", intro ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0")}>
          <div className="min-h-0 overflow-hidden">
            <p className="m-0 pt-2 text-sm leading-5 whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">{intro}</p>
          </div>
        </div>
        {keys.length > 0 && (
          <div className={cn("mt-3 gap-1.5", keys.length > 3 ? "grid grid-cols-2" : "flex")}>
            {keys.map((k) => (
              <button key={k.label} type="button" disabled={k.disabled} onClick={k.run} className="g-press flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-fill px-2 text-sm text-ink hover:bg-fill-2 disabled:opacity-50 pointer-coarse:h-10">
                <span className="shrink-0 text-ink-2">{k.icon}</span>
                <span className="truncate">{k.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
