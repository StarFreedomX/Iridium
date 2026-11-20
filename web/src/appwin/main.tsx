// The desktop app's own page (app/, docs/app.md "登录"): built apart (vite.app.config.ts) into
// app/assets/ui, with the web app's own parts and look.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { Login } from "./login";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Login />
  </StrictMode>,
);
