// The desktop app's own page (app/, docs/app.md "登录"): built apart (vite.app.config.ts) into
// app/assets/ui, with the web app's own parts and look.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { AskPanel } from "./ask";
import { Login } from "./login";

// The request panel is a window of its own, see-through round its rounded panel.
if (location.hash === "#ask")
  for (const el of [document.documentElement, document.body])
    el.style.background = "transparent";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.hash === "#ask" ? <AskPanel /> : <Login />}
  </StrictMode>,
);
