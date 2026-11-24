// A turn at work as it shows at the end of a session's own record (chat.tsx TranscriptView): the
// row of what is being written or run (Activity).
import type { Draft as Drafted } from "../chats";
import { cn } from "../ui";
import type { Tool } from "./fold";
import { ToolDraft, Waiting } from "./live";
import { Running } from "./said";

/** The turn's row at the end of the conversation: the call being written, else the one running
 *  (the newest, how many more beside it), else the dots once it has gone quiet; one line high, even
 *  empty, while the turn lasts. */
/** under: in a turn's frame of its own, under the face and name (the turn's first). */
export function Activity({ calls, running, cwd, quiet, grew, under }: { calls: Drafted[]; running: Tool[]; cwd: string; quiet: boolean; grew: string; under?: boolean }) {
  const writing = calls.at(-1);
  const run = running.at(-1);
  return (
    <div className={cn("flex h-7 min-w-0 items-center pointer-coarse:h-9", under ? "-mt-1" : "-mt-3 pl-[38px]")}>
      {/* One box for a call, written then running, under its id: it fades in once, not again
          as the call written begins to run. */}
      {writing?.tool ? (
        <div key={writing.tool.id} className="g-fade flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0 flex-1">
            <ToolDraft name={writing.tool.name} input={writing.text} whole={writing.whole} plain />
          </div>
        </div>
      ) : run ? (
        <div key={run.id ?? run.at} className="g-fade flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0 flex-1">
            <Running tool={run} cwd={cwd} />
          </div>
          {running.length > 1 && <span className="shrink-0 text-xs text-ink-4 tabular-nums">+{running.length - 1}</span>}
        </div>
      ) : (
        <Waiting on={quiet} quiet={grew} />
      )}
    </div>
  );
}
