// The sidebar's folder key and its dialog: loaded off the first screen (app.tsx), prefetching the
// active session's folder while idle and as the key is hovered, pressed or focused.
import { Dialog } from "@base-ui/react/dialog";
import { FolderOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { mayPrefetch } from "./chats";
import FileBrowser, { prefetchDirectory } from "./filebrowser";
import { FileWindow } from "./file-window";
import { t } from "./i18n";
import { settled } from "./prefetch";
import { Tip } from "./ui";

/** Sidebar trigger for the read-only file browser: opens at the active session's computer and
 *  folder (or the server's starting folder when none is open). */
export function FileBrowserKey({ machine, path }: { machine: string; path: string }) {
  const [open, setOpen] = useState(false);
  // Snapshot the opening location; bumping round remounts a fresh browser even if reopened mid-exit.
  const [start, setStart] = useState({ machine, path, round: 0 });
  const warm = useCallback(() => void prefetchDirectory(machine, path), [machine, path]);

  useEffect(() => {
    let current = true;
    void settled().then(() => current && mayPrefetch() && warm());
    return () => { current = false; };
  }, [warm]);

  return (
    <Dialog.Root open={open} onOpenChange={(on) => {
      if (on) {
        warm();
        setStart((was) => ({ machine, path, round: was.round + 1 }));
      }
      setOpen(on);
    }}>
      <Tip label={t("browse.title")}>
        <Dialog.Trigger
          aria-label={t("browse.title")}
          onPointerEnter={warm}
          onPointerDown={warm}
          onFocus={warm}
          className="g-press grid size-8 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-fill hover:text-ink pointer-coarse:size-10"
        >
          <FolderOpen size={17} />
        </Dialog.Trigger>
      </Tip>
      <FileWindow className="@container h-[min(640px,86dvh)]">
        <FileBrowser key={start.round} machine={start.machine} path={start.path} />
      </FileWindow>
    </Dialog.Root>
  );
}
