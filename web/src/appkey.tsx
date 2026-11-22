// The desktop app's key at the top bar's right (irapp.ts): in the app only. Pressed, the app's
// control pops up under it (internal/desktop/control.go, web/src/appwin): first the Iridium this
// window shows with its 授权操作, then this computer and the others; the app's own window, so
// this page cannot press its switches.
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
      onClick={(e) => {
        // Where the key is: the control opens under it (internal/desktop/control.go).
        const r = e.currentTarget.getBoundingClientRect();
        ask(
          "home",
          JSON.stringify({ X: r.x, Y: r.y, W: r.width, H: r.height }),
        );
      }}
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
