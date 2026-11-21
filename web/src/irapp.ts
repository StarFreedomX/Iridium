// The desktop app (app/, docs/app.md): in its window this page has the app's bridge
// (window._wails). Through it the page learns it is in the app and its state (the Iridiums in its
// list, this computer's terms for this one, the app's own), and asks things of it; what would give
// this Iridium more of the computer the app asks the person in a dialog of its own, never here.
import { useSyncExternalStore } from "react";

/** An Iridium in the app's list, with this computer as joined to it. */
export type AppServer = {
  url: string;
  host: string;
  current: boolean;
  local?: boolean; // this computer's own Iridium: never joined, its state in status
  joined: boolean;
  status: string; // the join's state, short
  shell: boolean;
  roots: string[]; // none: all
  agents: { name: string; on: boolean }[];
};
export type AppState = {
  app: "ir-app";
  version: string;
  name: string; // this computer's
  servers: AppServer[];
  autostart: boolean;
  update: string; // a new version downloaded, waiting for a restart; "": none
  hasLocal?: boolean; // this computer's own Iridium is in the list
  server?: boolean; // this computer's own Iridium is on (ir server on|off)
  error?: string; // what the last ask came to
  notice?: string;
  code?: string; // a browser login's code to check
};

type Bridge = { invoke: (msg: string) => void };
let state: AppState | null = null;
const told = new Set<() => void>();
const bridge = () => (window as unknown as { _wails?: Bridge })._wails;

window.addEventListener("ir-app", (e) => {
  const d = (e as CustomEvent).detail as Partial<AppState>;
  // A full state, or only what an ask came to.
  state = d.app
    ? (d as AppState)
    : state && { ...state, error: d.error, notice: d.notice, code: d.code };
  for (const f of told) f();
});

/** The bridge comes once the page has loaded (wails:runtime-config-ready), or is there already. */
let greeted = false;
function greet() {
  const b = bridge();
  if (greeted || !b || typeof b.invoke !== "function") return;
  greeted = true;
  b.invoke("wails:runtime:ready");
  b.invoke("ir:hello");
}
window.addEventListener("wails:runtime-config-ready", greet);
greet();

/** The page's day or night (data-theme, me.tsx applyTheme) told to the app as it is and as it
 *  changes: the app's own pages follow it (kumo, 2026-11-20). */
let themeTold = "";
function tellTheme() {
  const theme = document.documentElement.dataset.theme ?? "";
  if (!greeted || !theme || theme === themeTold) return;
  themeTold = theme;
  ask("theme", theme);
}
new MutationObserver(tellTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});
window.addEventListener("wails:runtime-config-ready", tellTheme);
tellTheme();

/** Asks the app: verb, and what it is about. */
export const ask = (verb: string, arg = "") =>
  bridge()?.invoke(`ir:${verb}${arg ? ":" + arg : ""}`);

/** The app's state; null: not in the app. */
export const useApp = () =>
  useSyncExternalStore(
    (f) => (told.add(f), () => void told.delete(f)),
    () => state,
    () => null,
  );
