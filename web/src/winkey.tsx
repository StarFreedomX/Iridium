// A window key of the desktop app's (internal/desktop/chrome.go): the windows have no title bar,
// their keys are the pages' own; the app's own pages (appwin) use it too, apart from the web
// app's data.
import type { ReactNode } from "react";
import { cn } from "./ui";

/** One window key: a round mark in a key the size of the bar's others. */
export function WinKey({ label, onClick, close, children }: { label: string; onClick: () => void; close?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="group/wk grid size-7 shrink-0 place-items-center rounded-md">
      <span
        className={cn(
          "grid size-3.5 place-items-center rounded-full bg-fill-2 text-ink-3 transition-colors duration-(--dur-1)",
          close ? "group-hover/wk:bg-err group-hover/wk:text-[#fff]" : "group-hover/wk:bg-ink-4 group-hover/wk:text-paper",
        )}
      >
        {children}
      </span>
    </button>
  );
}
