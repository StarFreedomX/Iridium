// The centered file dialog shared by chat previews (chat/files.tsx) and the file browser
// (filebrowser-key.tsx): one backdrop, centering and unfold animation.
import { Dialog } from "@base-ui/react/dialog";
import type { KeyboardEventHandler, ReactNode } from "react";
import { cn, DialogPortal } from "./ui";

/** Centered dialog shell for a file preview or the file browser; callers set height and layout. */
export function FileWindow({ className, children, onKeyDown }: { className?: string; children: ReactNode; onKeyDown?: KeyboardEventHandler<HTMLDivElement> }) {
  return (
    <DialogPortal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-paper/70 backdrop-blur-sm transition-opacity duration-(--dur-2) data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <Dialog.Popup onKeyDown={onKeyDown} className={cn("g-unfold fixed top-1/2 left-1/2 z-50 flex w-[min(960px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-paper text-ink shadow-(--shadow-float) outline-none", className)}>
        {children}
      </Dialog.Popup>
    </DialogPortal>
  );
}
