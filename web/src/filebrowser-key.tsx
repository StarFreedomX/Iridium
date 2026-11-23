// The sidebar's folder key, prefetching the active session's folder when the page is idle.
import { FolderOpen } from "lucide-react";
import { useEffect } from "react";
import { mayPrefetch } from "./chats";
import { FileBrowserTrigger, warmFileBrowser } from "./filebrowser-trigger";
import { t } from "./i18n";
import { settled } from "./prefetch";
import { Tip } from "./ui";

/** Sidebar trigger for the read-only file browser: opens at the active session's computer and
 *  folder (or the server's starting folder when none is open). */
export function FileBrowserKey({ machine, path }: { machine: string; path: string }) {
  useEffect(() => {
    let current = true;
    void settled().then(() => current && mayPrefetch() && warmFileBrowser({ machine, path }));
    return () => { current = false; };
  }, [machine, path]);

  return (
    <Tip label={t("browse.title")}>
      <FileBrowserTrigger
        place={{ machine, path }}
        aria-label={t("browse.title")}
        className="g-press grid size-8 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-fill hover:text-ink pointer-coarse:size-10"
      >
        <FolderOpen size={17} />
      </FileBrowserTrigger>
    </Tip>
  );
}
