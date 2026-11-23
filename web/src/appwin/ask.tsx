// A request from an Iridium for more of this computer, in the app's own small panel (app/ask.go):
// taken apart, one row an item (command lines, a folder, an agent), each switched on or off; then
// 拒绝 or 允许. Esc is 拒绝. The look is a popover's (PopSurface), the panel being the window.
import { useEffect, useState } from "react";
import type { Agent } from "../api/types.gen";
import { agentName, Logo, Switch } from "../ui";
import { ask, followTheme, onAnswer, whenReady } from "./bridge";

type Item = { kind: "shell" | "folder" | "agent"; value?: string };
type Asking = { server: string; by: string; items: Item[] };

export function AskPanel() {
  const [req, setReq] = useState<Asking | null>(null);
  const [on, setOn] = useState<boolean[]>([]);
  useEffect(() => {
    const stop = onAnswer((d) => {
      followTheme(d);
      if (!("ask" in d)) return;
      const a = d.ask as Asking | null;
      setReq(a);
      setOn(a ? a.items.map(() => true) : []);
    });
    whenReady(() => ask("ir:askstate"));
    return stop;
  }, []);
  const [always, setAlways] = useState(false);
  const answer = (yes: boolean[]) =>
    ask(
      "ir:answer:" +
        JSON.stringify({ yes, always: always && yes.some(Boolean) }),
    );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!req) return;
      if (e.key === "Escape") answer(req.items.map(() => false));
      if (e.key === "Enter") answer(on);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [req, on, always]);
  if (!req) return null;
  return (
    <div data-app-drag className="h-full bg-paper select-none">
      <div className="flex h-full flex-col p-4 text-ink">
        <h1 className="m-0 truncate text-sm font-medium">
          {req.by ? `${req.by} 请求` : `${req.server} 请求`}
        </h1>
        {req.by && (
          <p className="m-0 truncate text-xs text-ink-3">{req.server}</p>
        )}
        <div className="mt-2 flex flex-1 flex-col">
          {req.items.map((it, i) => (
            <div key={i} className="flex h-11 items-center gap-2.5 text-sm">
              {it.kind === "agent" && (
                <Logo agent={it.value as Agent} size={15} />
              )}
              <span className="min-w-0 flex-1 truncate">
                {it.kind === "shell"
                  ? "命令行"
                  : it.kind === "agent"
                    ? agentName(it.value as Agent)
                    : it.value}
              </span>
              <Switch
                label={it.kind === "shell" ? "命令行" : (it.value ?? "")}
                on={on[i] ?? false}
                onChange={(v) => setOn(on.map((x, j) => (j === i ? v : x)))}
              />
            </div>
          ))}
        </div>
        {/* This Iridium asks no more here: what it asks for after is allowed (kumo, 2026-11-22). */}
        <div className="flex h-11 items-center gap-2.5 text-sm text-ink-2">
          <span className="min-w-0 flex-1 truncate">
            以后都允许 {req.server}
          </span>
          <Switch label="以后都允许" on={always} onChange={setAlways} />
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => answer(req.items.map(() => false))}
            className="g-press h-9 flex-1 rounded-lg bg-fill text-sm"
          >
            拒绝
          </button>
          <button
            type="button"
            onClick={() => answer(on)}
            className="g-press h-9 flex-1 rounded-lg bg-ink text-sm font-medium text-paper"
          >
            允许
          </button>
        </div>
      </div>
    </div>
  );
}
