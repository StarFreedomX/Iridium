// The page (docs/plan.md "网页"): one sidebar and a main pane, kept live by one event stream.
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "./api/client";
import { App } from "./app";
import { restore, watch } from "./device/first";
import { watchInstall } from "./install";
import "./styles.css";
import { watchUpgrade } from "./upgrade";

watchUpgrade();
watchInstall();
// The sidebar and the faces as this device last had them, in the first frame (device/first.ts).
restore();
watch();
// The chats' copies read from the first press: their code here before it (device/chats.ts).
void import("./device/chats").catch(() => {});

// A file dropped anywhere off the chat, which attaches it, is not opened by the browser in place of the page.
const keepFile = (e: DragEvent) => e.dataTransfer?.types.includes("Files") && e.preventDefault();
addEventListener("dragover", keepFile);
addEventListener("drop", keepFile);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
