// The centered file dialog shared by chat previews (chat/files.tsx) and the file browser
// (filebrowser-key.tsx): one backdrop, centering and unfold animation.
import { Dialog } from "@base-ui/react/dialog";
import type { KeyboardEventHandler, ReactNode } from "react";
import { cn, DialogPortal } from "./ui";

/** Centered dialog shell for a file preview, the file browser or the usage; callers set height and
 *  layout. full: the whole screen (the usage in a portrait layout). */
export function FileWindow({ className, children, onKeyDown, full }: { className?: string; children: ReactNode; onKeyDown?: KeyboardEventHandler<HTMLDivElement>; full?: boolean }) {
  return (
    <DialogPortal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-paper/70 backdrop-blur-sm transition-opacity duration-(--dur-2) data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <Dialog.Popup
        onKeyDown={onKeyDown}
        className={cn(
          "g-unfold fixed z-50 flex flex-col overflow-hidden bg-paper text-ink outline-none",
          full ? "inset-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" : "top-1/2 left-1/2 w-[min(960px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl shadow-(--shadow-float)",
          className,
        )}
      >
        {children}
      </Dialog.Popup>
    </DialogPortal>
  );
}
