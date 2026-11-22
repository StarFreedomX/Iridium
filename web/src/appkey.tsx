// The desktop app's key at the top bar's right (irapp.ts): in the app only. Pressed, the window
// goes to the app's own control page (internal/desktop, web/src/appwin): this computer, the
// servers, each one's 授权操作 (kumo, 2026-11-22: a page of its own, not a popover).
import { MonitorSmartphone } from "lucide-react";
import { useEffect } from "react";
import { useMe } from "./data";
import { t } from "./i18n";
import { ask, useApp } from "./irapp";
import { IconKey } from "./ui";

export function AppKey() {
  const app = useApp();
  useTellMe(!!app);
  if (!app) return null;
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
