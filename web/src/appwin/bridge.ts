// The desktop app's bridge (app/, docs/app.md), for its own pages (this directory): messages to
// the app (window._wails.invoke) and its answers (the window's "ir-app" events).

type Wails = { invoke: (msg: string) => void };
const wails = () => (window as unknown as { _wails?: Wails })._wails;

/** Asks the app: false when its bridge is not here. */
export function ask(msg: string): boolean {
  const w = wails();
  if (!w || typeof w.invoke !== "function") return false;
  w.invoke(msg);
  return true;
}

/** Calls f with each answer of the app; the returned function stops it. */
export function onAnswer(f: (d: Record<string, unknown>) => void): () => void {
  const h = (e: Event) =>
    f(((e as CustomEvent).detail ?? {}) as Record<string, unknown>);
  window.addEventListener("ir-app", h);
  return () => window.removeEventListener("ir-app", h);
}

/** once the bridge is here (it comes as the page has loaded): ready, then f. */
export function whenReady(f: () => void) {
  let done = false;
  const go = () => {
    if (done || !wails()) return;
    done = true;
    ask("wails:runtime:ready");
    f();
  };
  window.addEventListener("wails:runtime-config-ready", go);
  go();
}

const MAC = /Mac/.test(navigator.platform);

/** ⌘C, ⌘X, ⌘V, ⌘A in a text field, through the app: a macOS web view of this kind does not
 *  paste by itself (kumo, 2026-11-20). Elsewhere the keys work as they are. set: the field's new
 *  value, as React holds it. */
export function clipboardKeys(
  e: React.KeyboardEvent<HTMLInputElement>,
  set: (v: string) => void,
) {
  if (!MAC || !e.metaKey || e.altKey || e.ctrlKey) return;
  const el = e.currentTarget;
  const [a, b] = [
    el.selectionStart ?? el.value.length,
    el.selectionEnd ?? el.value.length,
  ];
  const put = (text: string) => {
    const v = el.value.slice(0, a) + text + el.value.slice(b);
    set(v);
    requestAnimationFrame(() =>
      el.setSelectionRange(a + text.length, a + text.length),
    );
  };
  switch (e.key.toLowerCase()) {
    case "v": {
      e.preventDefault();
      const stop = onAnswer((d) => {
        if (typeof d.clipboard !== "string") return;
        stop();
        put(d.clipboard.replace(/[\r\n]+/g, " ").trim());
      });
      if (!ask("ir:clipboard")) stop();
      return;
    }
    case "c":
    case "x":
      if (a === b) return;
      e.preventDefault();
      ask("ir:copy:" + el.value.slice(a, b));
      if (e.key.toLowerCase() === "x") put("");
      return;
    case "a":
      e.preventDefault();
      el.select();
  }
}

/** The day or night the Iridium's page was last in (app/gui.go "theme"), on this page too. */
export function followTheme(d: Record<string, unknown>) {
  const dark =
    d.theme === "dark" ||
    (d.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (d.theme === "dark" || d.theme === "light" || d.theme === "auto")
    document.documentElement.dataset.theme = dark ? "dark" : "light";
}
