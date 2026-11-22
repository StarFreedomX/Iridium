// The desktop app's key at the top bar's right (irapp.ts): in the app only. Pressed, the app's own
// window comes (internal/desktop/picker.go, web/src/appwin): 服务器 and 授权操作; the app's own, so
// this page cannot press its switches.
import { MonitorSmartphone } from "lucide-react";
import { useEffect } from "react";
import { useMe } from "./data";
import { t } from "./i18n";
import { ask, useApp } from "./irapp";
import { IconKey, MAC } from "./ui";

/** The key in a page's top bar: Windows and Linux, whose windows have the system's title bar. On a
 *  Mac it is in the window's top strip instead (AppStripKey). */
export function AppKey() {
  const app = useApp();
  if (!app || MAC) return null;
  return (
    <IconKey
      label={t("app.title")}
      tipSide="bottom"
      onClick={() => ask("home")}
    >
      <MonitorSmartphone size={16} />
    </IconKey>
  );
}

/** On a Mac, the key at the right end of the window's top strip, where its three buttons are at
 *  the left (kumo, 2026-11-22); the app leaves that end of the strip to the page. Once in the page. */
export function AppStripKey() {
  const app = useApp();
  useTellMe(!!app);
  if (!app || !MAC) return null;
  return (
    <span className="fixed top-0 right-2 z-50 flex h-7 items-center">
      <IconKey
        label={t("app.title")}
        tipSide="bottom"
        onClick={() => ask("home")}
        className="size-6"
      >
        <MonitorSmartphone size={14} />
      </IconKey>
    </span>
  );
}

/** In the app, who this page is (name, face) told to it, for its own page's list of Iridiums. */
function useTellMe(inApp: boolean) {
  const me = useMe().data;
  const name = me?.name ?? "";
  const avatar = me?.avatar ?? "";
  useEffect(() => {
    if (!inApp || !name) return;
    let gone = false;
    const tell = (face: string) =>
      !gone && ask("me", JSON.stringify({ name, avatar: face }));
    if (!avatar) return void tell("");
    fetch(avatar)
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then(
        (b) =>
          new Promise<string>((done) => {
            const f = new FileReader();
            f.onload = () => done(String(f.result));
            f.readAsDataURL(b);
          }),
      )
      .then(tell, () => tell(""));
    return () => void (gone = true);
  }, [inApp, name, avatar]);
}
