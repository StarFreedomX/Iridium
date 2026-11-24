// The installed app's strip logic (as before this change) run against the page: does a strip ever come?
import { chromium } from "playwright-core";
import fs from "node:fs";
const url = `http://127.0.0.1:${fs.readFileSync("/tmp/irperf/run/port", "utf8").trim()}/`;
const b = await chromium.launch({ executablePath: "/home/iridium/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
await p.addInitScript(() => {
  window.__strip = 0; const H = 32;
  function plain() { var have = document.querySelector("[data-win-keys]:not([data-win-keys=app])"), ours = document.getElementById("ir-strip");
    if (have) { if (ours) { ours.remove(); document.documentElement.style.removeProperty("--ir-strip"); } return; }
    if (ours || !document.body || !document.getElementById("root") || !document.getElementById("root").children.length) return;
    var d = document.createElement("div"); d.id = "ir-strip"; document.body.appendChild(d); document.documentElement.style.setProperty("--ir-strip", H + "px"); window.__strip++; }
  setInterval(plain, 100);
});
await p.goto(url + "?lang=en"); await p.waitForTimeout(4000);
console.log("strips made:", await p.evaluate(() => window.__strip), "marker in page:", await p.evaluate(() => !!document.querySelector('[data-win-keys="page"]')));
await b.close();
