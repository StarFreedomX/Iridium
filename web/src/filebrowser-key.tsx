import { Dialog } from "@base-ui/react/dialog";
import { FolderOpen, LoaderCircle } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { mayPrefetch } from "./chats";
import { t } from "./i18n";
import { settled } from "./prefetch";
import { Tip } from "./ui";

const load = () => import("./filebrowser");
const FileBrowser = lazy(load);

export function FileBrowserKey({ machine, path }: { machine: string; path: string }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState({ machine, path, round: 0 });
  const warm = useCallback(() => void load().then((m) => m.prefetchDirectory(machine, path)).catch(() => {}), [machine, path]);

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
        <Dialog.Trigger aria-label={t("browse.title")} onPointerEnter={warm} onPointerDown={warm} onFocus={warm} className="g-press grid size-8 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-fill hover:text-ink pointer-coarse:size-10">
          <FolderOpen size={17} />
        </Dialog.Trigger>
      </Tip>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-paper/70 backdrop-blur-sm transition-opacity duration-(--dur-2) data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="g-unfold @container fixed top-1/2 left-1/2 z-50 flex h-[min(640px,86dvh)] w-[min(960px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-paper text-ink shadow-(--shadow-float) outline-none">
          <Suspense fallback={
            <div className="grid h-full place-items-center text-ink-3">
              <Dialog.Title className="sr-only">{t("browse.title")}</Dialog.Title>
              <LoaderCircle size={18} className="animate-spin" />
            </div>
          }>
            <FileBrowser key={start.round} machine={start.machine} path={start.path} />
          </Suspense>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
