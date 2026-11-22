// Sidebar and chat folder keys reach the same dialog. Their code and listing are warmed ahead.
// Shared trigger and dialog handle for the read-only file browser: used by the sidebar key
// (filebrowser-key.tsx) and chat folder mentions/cards (chat/mention.tsx), falling back to
// openPlace when no browser dialog is mounted.
import { Dialog } from "@base-ui/react/dialog";
import { mergeProps } from "@base-ui/react/merge-props";
import { createContext, useContext, type ComponentProps } from "react";
import { openPlace, type Place } from "./places";

export const FileBrowserHandle = createContext<ReturnType<typeof Dialog.createHandle<Place>> | null>(null);
export const loadFileBrowser = () => import("./filebrowser");

/** Prefetch the browser chunk and the folder it will open at. */
export function warmFileBrowser({ machine, path }: Place) {
  void loadFileBrowser().then((m) => m.prefetchDirectory(machine ?? "", path)).catch(() => {});
}

/** Button that opens the shared file browser at place (prefetching on hover, press and focus);
 *  outside a page with a browser, falls back to openPlace. */
export function FileBrowserTrigger({ place, ...button }: ComponentProps<"button"> & { place?: Place }) {
  const handle = useContext(FileBrowserHandle);
  if (!place || !handle) {
    return <button {...mergeProps<"button">({ type: "button" }, button, {
      disabled: !place || button.disabled,
      onClick: () => place && openPlace(place),
    })} />;
  }
  const warm = () => warmFileBrowser(place);
  return (
    <Dialog.Trigger
      handle={handle}
      payload={place}
      disabled={button.disabled}
      render={<button type="button" {...button} />}
      onPointerEnter={warm}
      onPointerDown={warm}
      onFocus={warm}
      onClick={warm}
    />
  );
}
