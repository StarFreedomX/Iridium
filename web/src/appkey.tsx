// The desktop app's key at the top bar's right (irapp.ts): in the app only, its panel in a
// popover: the Iridiums (switch, add), this computer for this one, the app itself.
import { Popover } from "@base-ui/react/popover";
import { MonitorSmartphone } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { t } from "./i18n";
import { useApp } from "./irapp";
import { IconKey, PopSurface } from "./ui";

const Panel = lazy(() => import("./apppanel"));

export function AppKey() {
  const app = useApp();
  const [open, setOpen] = useState(false);
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
