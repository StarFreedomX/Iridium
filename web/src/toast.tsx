// Light toasts (plan "风格": frosted, popping in), one manager for the page: an action's receipt or
// error, a turn done elsewhere with a key to open it.
import { Toast } from "@base-ui/react/toast";
import { CircleAlert, Download } from "lucide-react";
import type { CSSProperties } from "react";
import { ApiError, noAnswer } from "./api/client";
import type { Agent } from "./api/types.gen";
import { t } from "./i18n";
import { Logo } from "./ui";

export const toasts = Toast.createToastManager();

/** Active download state in a toast: ring percentage, byte counts, and an optional cancel action. */
type DownloadProgress = { pct?: number; got?: number; total?: number; cancel?: () => void };
/** mark: the icon before the words (download: one done). file: the description is a file's
 *  name, cut in its middle (FileName). progress: replaces the icon and description
 *  with a progress ring, fixed-width byte readout, and cancel key, and disables swipe-to-dismiss. */
type Data = { agent?: Agent; jump?: string; error?: boolean; undo?: () => void; mark?: "download"; file?: boolean; progress?: DownloadProgress };

/** A toast: title, maybe a line after it; error ones stay 8 s. undo: a key that takes back what
 *  was done, the toast staying 6 s. */
export function toast(title: string, { description, timeout, ...data }: Data & { description?: string; timeout?: number } = {}): string {
  return toasts.add({ title, description, timeout: timeout ?? (data.error ? 8000 : data.undo ? 6000 : 2500), data });
}

/** An error's words for a toast. */
/** What went wrong, for people: the network gone, the service down a moment (a gateway's 502-504,
 *  as while it restarts), a bare status said as one; else the server's own words. */
export const errText = (e: unknown) => {
  if (e instanceof TypeError) return t("err.offline");
  if (noAnswer(e)) return t("err.noAnswer");
  if (e instanceof ApiError && /^\d+$/.test(e.message)) return e.status >= 502 && e.status <= 504 ? t("err.unavailable") : t("err.status", { code: e.status });
  return e instanceof Error ? e.message : String(e);
};

const toastKey = "g-press ml-1 h-7 shrink-0 rounded-full bg-fill px-3 text-xs font-medium hover:bg-fill-2";

/** Progress ring with the percentage inset (spins while the total size is unknown); a visually
 *  hidden <progress> carries the semantics for assistive technology. */
function DownloadRing({ pct }: DownloadProgress) {
  const percent = pct === undefined ? undefined : `${pct}%`;
  return (
    <span className="relative grid size-7 shrink-0 place-items-center text-xs leading-none font-semibold tabular-nums">
      <progress className="sr-only" aria-label={t("app.downloading")} aria-valuetext={percent} max={100} value={pct} />
      <span
        aria-hidden="true"
        className={`download-ring absolute inset-0 rounded-full ${pct === undefined ? "motion-safe:animate-spin" : ""}`}
        style={{ "--download-progress": percent ?? "25%" } as CSSProperties}
      />
      <span aria-hidden="true">{pct}</span>
    </span>
  );
}

/** Formats downloaded / total bytes in one unit chosen from the total (or got when total is unknown),
 *  so the fixed-width readout stays compact and steady as digits grow. */
function downloadBytes(got: number, total?: number) {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const extent = total && total > 0 ? total : got;
  const unit = Math.min(units.length - 1, Math.floor(Math.log2(Math.max(1, extent)) / 10));
  const format = (bytes: number) => {
    const value = bytes / 1024 ** unit;
    return `${Number(value.toFixed(unit > 0 && value < 10 ? 1 : 0))}${units[unit]}`;
  };
  return total !== undefined && total > 0 ? `${format(got)}/${format(total)}` : format(got);
}

export function ToastList({ onJump }: { onJump: (id: string) => void }) {
  const { toasts: list } = Toast.useToastManager();
  return list.map((toast) => {
    const d = toast.data as Data | undefined;
    const progress = d?.progress;
    return (
      <Toast.Root key={toast.id} toast={toast} swipeDirection={progress ? [] : undefined} className="g-pop-t glass thick float flex h-10 max-w-full items-center gap-2.5 rounded-full pr-1.5 pl-3.5 text-sm text-ink">
        {d?.agent && <Logo agent={d.agent} size={15} />}
        {d?.error && <CircleAlert size={15} className="shrink-0 text-err" />}
        {progress && <DownloadRing pct={progress.pct} />}
        {d?.mark === "download" && <Download size={15} className="shrink-0 text-ink-3" />}
        {/* The title whole beside a description (已下载, not 已...): only the description gives way;
            a download's, its file's name, gives way itself to the bytes. */}
        <Toast.Title className={progress ? "min-w-0 truncate font-medium tabular-nums" : "max-w-full shrink-0 truncate font-medium tabular-nums"} />
        {progress ? (
          progress.got !== undefined && <span className="w-[14ch] shrink-0 text-right text-xs whitespace-nowrap text-ink-2 tabular-nums">{downloadBytes(progress.got, progress.total)}</span>
        ) : d?.file && typeof toast.description === "string" ? (
          <Toast.Description className="flex min-w-0 shrink text-ink-2">
            <FileName name={toast.description} />
          </Toast.Description>
        ) : (
          <Toast.Description className="min-w-0 shrink truncate text-ink-2" />
        )}
        {progress?.cancel ? (
          <Toast.Action onClick={progress.cancel} className={toastKey}>
            {t("me.cancel")}
          </Toast.Action>
        ) : d?.undo ? (
          <Toast.Close onClick={d.undo} className={toastKey}>
            {t("toast.undo")}
          </Toast.Close>
        ) : d?.jump ? (
          <Toast.Close onClick={() => onJump(d.jump!)} className={toastKey}>
            {t("toast.open")}
          </Toast.Close>
        ) : (
          <span className="w-2" />
        )}
      </Toast.Root>
    );
  });
}

/** A file's name cut in its middle as room runs out (AI智能问诊…确认事项.docx): its last few
 *  characters and its extension kept whole. */
function FileName({ name }: { name: string }) {
  const chars = Array.from(name);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 10 ? Array.from(name.slice(dot)).length : 0;
  const keep = ext + 4;
  if (chars.length <= keep + 2) return <span className="truncate">{name}</span>;
  return (
    <>
      <span className="min-w-0 truncate">{chars.slice(0, -keep).join("")}</span>
      <span className="shrink-0 whitespace-pre">{chars.slice(-keep).join("")}</span>
    </>
  );
}
