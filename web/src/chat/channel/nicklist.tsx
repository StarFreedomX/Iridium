// The agents an @ may call in a channel of several, over the composer as what an @ names is
// elsewhere (composer.tsx AtList): a row each, its logo, its nick, what it runs as faint at the
// end, its lamp. ↑↓ and Enter or Tab on a keyboard, a tap on a phone.
import type { CSSProperties } from "react";
import { t } from "../../i18n";
import { cn, Lamp, Logo } from "../../ui";
import type { AgentRow } from "./lib";

export function NickList({ rows, at, pick, point }: { rows: AgentRow[]; at: number; pick: (r: AgentRow) => void; point: (i: number) => void }) {
  return (
    <div role="listbox" aria-label={t("channel.agents")} className="g-pop glass thick float absolute bottom-full left-2 z-10 mb-2 max-h-[min(360px,50dvh)] w-80 max-w-[calc(100%-16px)] origin-bottom-left no-bar overflow-y-auto overscroll-contain rounded-lg p-1.5 text-ink">
      <div className="g-stagger flex flex-col">
        {rows.map((r, i) => (
          <button
            key={r.session}
            type="button"
            role="option"
            aria-selected={i === at}
            ref={(el) => void (i === at && el?.scrollIntoView({ block: "nearest" }))}
            onPointerDown={(e) => e.preventDefault()}
            onPointerMove={() => i === at || point(i)}
            onClick={() => pick(r)}
            style={{ "--i": i } as CSSProperties}
            className={cn("flex h-8 w-full shrink-0 cursor-default items-center gap-2.5 rounded-md px-2.5 text-left text-base outline-none select-none pointer-coarse:h-11", i === at && "bg-fill")}
          >
            <Logo agent={r.agent} size={14} className="shrink-0" />
            <span className="shrink-0">{r.nick}</span>
            <span className="min-w-0 flex-1 truncate text-right text-xs text-ink-3">{r.name}</span>
            <Lamp status={r.status} />
          </button>
        ))}
      </div>
    </div>
  );
}
