import { mergeProps } from "@base-ui/react/merge-props";
import { useContext, type ComponentProps } from "react";
import { FileBrowserOpen, openPlace, type Place } from "./places";

export const loadFileBrowser = () => import("./filebrowser");

export function warmFileBrowser({ machine, path }: Place) {
  void loadFileBrowser().then((m) => m.prefetchDirectory(machine ?? "", path)).catch(() => {});
}

export function FileBrowserTrigger({ place, ...button }: ComponentProps<"button"> & { place?: Place }) {
  const open = useContext(FileBrowserOpen);
  const warm = () => open && place && warmFileBrowser(place);
  return (
    <button {...mergeProps<"button">({ type: "button" }, button, {
      disabled: !place || button.disabled,
      "aria-haspopup": open && place ? "dialog" : undefined,
      onPointerEnter: warm,
      onPointerDown: warm,
      onFocus: warm,
      onClick: (e) => {
        if (!place) return;
        if (!open) return openPlace(place);
        warmFileBrowser(place);
        open(place, e.currentTarget);
      },
    })} />
  );
}
