// The desktop app's key at the top bar's right (irapp.ts): in the app only. Pressed, the app's own
// window comes (internal/desktop/picker.go, web/src/appwin): 服务器 and 授权操作; the app's own, so
// this page cannot press its switches. Pressed again, that window goes.
import { MonitorSmartphone } from "lucide-react";
import { useEffect } from "react";
import { useMe } from "./data";
import { t } from "./i18n";
import { ask, useApp } from "./irapp";
import { IconKey } from "./ui";

export function AppKey() {
  const app = useApp();
  if (!app) return null;
  return (
    <IconKey label={t("app.title")} tipSide="bottom" onClick={() => ask("home")}>
      <MonitorSmartphone size={16} />
    </IconKey>
  );
}

/** Who this page is, told to the app. Once in the page. In a Mac window's top strip the key was
 *  tried and taken back (kumo, 2026-11-22: pressed twice there, the window went full screen). */
export function AppTell() {
  useTellMe(!!useApp());
  return null;
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
