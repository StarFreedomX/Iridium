// The desktop app's own page (app/, docs/app.md "登录"): built apart (vite.app.config.ts) into
// app/assets/ui, with the web app's own parts and look.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { AskPanel } from "./ask";
import { Login } from "./login";

// The web view's own menu (Reload and the like) nowhere in the app's pages: their rows have their
// own (kumo, 2026-11-23). Where one types, the system's, for cut, copy and paste.
addEventListener("contextmenu", (e) => {
  if (!(e.target as Element).closest?.("input,textarea")) e.preventDefault();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.hash === "#ask" ? <AskPanel /> : <Login />}
  </StrictMode>,
);
