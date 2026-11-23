// The device's cache at start (docs/plan.md "本机缓存"): the worker registered wherever it can be
// (https, localhost: a secure context), the cache swept now and once a day after. Imported once
// the first screen has settled (app.tsx). Where there is no worker (plain http, a web view without
// one), the faces and pictures are the browser's own cache's alone; nothing here fails.
import { refresh } from "./state";
import { sweepDue } from "./store";

export function start() {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext)
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  // The 缓存 page's numbers read ahead, after the sweep.
  void sweepDue(true)
    .catch(() => {})
    .then(refresh);
  setInterval(() => void sweepDue().catch(() => {}), 3_600_000);
}

start();
