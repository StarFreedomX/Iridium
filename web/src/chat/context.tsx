// A channel's <channel-context> as its agent was given it (given.ts parseGiven), in its own
// session's record: one element, its sections in the text's order, every line from the raw text,
// nothing added or dropped (kumo, 2026-11-26). 说明 (the standing words, or the brief "…as
// before." line) and 工作, 命令 as the monospace text they are; 新消息 as a forward's rows, one a
// line, verbatim (a cut one keeps its "[…N more characters …]"). 原文 at its top right shows the
// block itself. Nothing folds: it is drawn whole, nothing moves as it opens.
import { useState } from "react";
import { t } from "../i18n";
import { cn } from "../ui";
import { FORWARD_CARD, ForwardRow } from "./forwardcard";
import { shownRaw, type CtxKind, type GivenTurn } from "./given";

const LABEL: Record<CtxKind, Parameters<typeof t>[0]> = { about: "channel.ctxAbout", new: "channel.ctxNew", work: "channel.ctxWork", cmds: "channel.ctxCmds" };
const MONO = "m-0 font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]";

/** g's context block. */
export function ChannelContext({ g }: { g: GivenTurn }) {
  const [raw, setRaw] = useState(false);
  const block = g.open.replace(/^\n+/, "") + g.sections.map((s) => s.raw).join("") + g.close;
  return (
    <div className="flex w-[min(640px,100%)] min-w-0 flex-col gap-2 rounded-xl border border-edge px-3.5 py-2.5 text-left">
      <div className="flex h-5 items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium text-ink-2">{t("channel.ctx")}</span>
        <button type="button" aria-pressed={raw} onClick={() => setRaw(!raw)} className={cn("shrink-0 rounded-sm px-1 hover:text-ink-2", raw ? "text-ink-2" : "text-ink-4")}>
          {t("channel.ctxRaw")}
        </button>
      </div>
      {raw ? (
        <pre className={cn(MONO, "text-ink-2")}>{block}</pre>
      ) : (
        g.sections.map((s, i) => (
          <section key={i} className="flex min-w-0 flex-col gap-1">
            <div className="text-xs text-ink-4">{t(LABEL[s.kind])}</div>
            {s.kind === "new" ? (
              <div className={cn(FORWARD_CARD, "w-full max-w-full gap-1")}>
                {s.rows.map((r, j) =>
                  r.kind === "line" ? (
                    <ForwardRow key={j} who={r.head} inline>
                      {shownRaw(r.words)}
                    </ForwardRow>
                  ) : (
                    <pre key={j} className={cn(MONO, "text-ink-3")}>
                      {shownRaw(r.raw)}
                    </pre>
                  ),
                )}
              </div>
            ) : (
              <pre className={cn(MONO, s.kind === "about" ? "text-ink-2" : "text-ink-3")}>{shownRaw(s.raw)}</pre>
            )}
          </section>
        ))
      )}
    </div>
  );
}

/** What came after the block, as it is (a "Session title: …" line). */
export function AfterContext({ text }: { text: string }) {
  return text.trim() ? <pre className={cn(MONO, "w-[min(640px,100%)] text-left text-ink-3")}>{text.replace(/^\n/, "")}</pre> : null;
}

/** The session's system prompt, verbatim: one block at the top of its record. */
export function SystemPrompt({ text }: { text: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-edge px-3.5 py-2.5">
      <div className="text-xs font-medium text-ink-2">{t("channel.systemPrompt")}</div>
      <pre className={cn(MONO, "text-ink-2")}>{text}</pre>
    </div>
  );
}
