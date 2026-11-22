import { Dialog } from "@base-ui/react/dialog";
import { FolderOpen, LoaderCircle } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { mayPrefetch } from "./chats";
import { FileBrowserTrigger, loadFileBrowser, warmFileBrowser } from "./filebrowser-trigger";
import { t } from "./i18n";
import { FileBrowserOpen, type OpenFileBrowser, type Place } from "./places";
import { settled } from "./prefetch";
import { Tip } from "./ui";

const FileBrowser = lazy(loadFileBrowser);

export function FileBrowserKey({ machine, path, onOpen }: { machine: string; path: string; onOpen: OpenFileBrowser }) {
  useEffect(() => {
    let current = true;
    void settled().then(() => current && mayPrefetch() && warmFileBrowser({ machine, path }));
    return () => { current = false; };
  }, [machine, path]);

  return (
    <FileBrowserOpen.Provider value={onOpen}>
      <Tip label={t("browse.title")}>
        <FileBrowserTrigger place={{ machine, path }} aria-label={t("browse.title")} className="g-press grid size-8 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-fill hover:text-ink pointer-coarse:size-10">
          <FolderOpen size={17} />
        </FileBrowserTrigger>
      </Tip>
    </FileBrowserOpen.Provider>
  );
}

export function FileBrowserDialog({ place, opener, round, open, onOpenChange }: {
  place: Place;
  opener: HTMLButtonElement;
  round: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-paper/70 backdrop-blur-sm transition-opacity duration-(--dur-2) data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup finalFocus={() => opener} className="g-unfold @container fixed top-1/2 left-1/2 z-50 flex h-[min(640px,86dvh)] w-[min(960px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-paper text-ink shadow-(--shadow-float) outline-none">
          <Suspense fallback={
            <div className="grid h-full place-items-center text-ink-3">
              <Dialog.Title className="sr-only">{t("browse.title")}</Dialog.Title>
              <LoaderCircle size={18} className="animate-spin" />
            </div>
          }>
            <FileBrowser key={round} machine={place.machine ?? ""} path={place.path} />
          </Suspense>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
