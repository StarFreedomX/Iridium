// The desktop app's key at the top bar's right (irapp.ts): in the app only, its panel in a
// popover: the Iridiums (switch, add), this computer for this one, the app itself.
import { Popover } from "@base-ui/react/popover";
import { MonitorSmartphone } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useMe } from "./data";
import { t } from "./i18n";
import { ask, useApp } from "./irapp";
import { IconKey, PopSurface } from "./ui";

const Panel = lazy(() => import("./apppanel"));

export function AppKey() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  useTellMe(!!app);
  if (!app) return null;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <IconKey
            label={t("app.title")}
            tipSide="bottom"
            className="data-popup-open:bg-fill"
          >
            <MonitorSmartphone size={16} />
          </IconKey>
        }
      />
      <PopSurface align="end" className="w-[min(320px,calc(100vw-16px))]">
        <Suspense fallback={<div className="h-40" />}>
          <Panel app={app} />
        </Suspense>
      </PopSurface>
    </Popover.Root>
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
