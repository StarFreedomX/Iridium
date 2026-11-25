// What the home pane's splash draws, chosen in the settings (主页; kumo, 2026-11-25), kept on this
// device: none at all; Iridium's letters alone; the faces (the letters, then the agent pointed at
// or added: as it was); or a picture of one's own, always.
import { useSyncExternalStore } from "react";
import { keep, kept } from "../ui";

export type HomeStyle = "none" | "ir" | "face" | "own";
export const HOME_STYLES: HomeStyle[] = ["none", "ir", "face", "own"];

const heard = new Set<() => void>();
const read = (): HomeStyle => {
  const v = kept("home") as HomeStyle | null;
  return v && HOME_STYLES.includes(v) ? v : "face";
};
let style = read();
let own = kept("homePicture") ?? "";
const tell = () => heard.forEach((h) => h());
const listen = (h: () => void) => (heard.add(h), () => void heard.delete(h));

export const useHomeStyle = () => useSyncExternalStore(listen, () => style);
/** One's own picture, a data: URL; "" none chosen yet. */
export const useHomePicture = () => useSyncExternalStore(listen, () => own);

export function setHomeStyle(v: HomeStyle) {
  style = v;
  keep("home", v === "face" ? null : v);
  tell();
}

/** A picture chosen: cut to a square about its middle, 256 across, kept; then the style is it. */
export async function setHomePicture(f: Blob): Promise<void> {
  const img = await createImageBitmap(f);
  const s = Math.min(img.width, img.height);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  c.getContext("2d")!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
  own = c.toDataURL("image/webp", 0.9);
  keep("homePicture", own);
  setHomeStyle("own");
}
