// The app's login page: Iridium's mark, the Iridium to log in to (a menu of those in the app's
// list, one to add), and the key that logs in from the system's browser, where the passkey is.
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronsUpDown, LoaderCircle, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn, IrMark } from "../ui";
import { ask, clipboardKeys, onAnswer, whenReady } from "./bridge";

type Server = { url: string; host: string };
const ITEM =
  "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-base outline-none select-none data-highlighted:bg-fill";

export function Login() {
  const [servers, setServers] = useState<Server[] | null>(null);
  const [current, setCurrent] = useState("");
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stop = onAnswer((d) => {
      if (Array.isArray(d.servers)) {
        setServers(d.servers as Server[]);
        setCurrent(String(d.current ?? ""));
        if (d.added) (setAdding(false), setAddress(""));
      }
      if (typeof d.code === "string")
        setNote({ text: `在浏览器中核对代码 ${d.code} 后允许` });
      if (typeof d.error === "string")
        (setBusy(false), setNote({ text: d.error, error: true }));
    });
    whenReady(() => ask("ir:hello"));
    return stop;
  }, []);

  const none = servers !== null && servers.length === 0;
  const typing = adding || none;
  useEffect(() => {
    if (typing) field.current?.focus();
  }, [typing]);

  const login = () => {
    if (busy) return;
    const to = typing ? address.trim() : current;
    if (!to) return setNote({ text: "填写服务器地址", error: true });
    setBusy(true);
    setNote(null);
    if (!ask("ir:login:" + to))
      (setBusy(false), setNote({ text: "无法连接应用", error: true }));
  };
  const host = servers?.find((s) => s.url === current)?.host ?? "";

  return (
    <main className="grid h-full place-items-center bg-paper text-ink select-none [&_*:focus-visible]:outline-none">
      <div
        className={cn(
          "flex w-[min(320px,calc(100vw-32px))] flex-col",
          servers === null && "invisible",
        )}
      >
        {/* The mark and the name in a row, the mark's edge on the key's (kumo, 2026-11-20). */}
        <h1 className="m-0 mb-6 flex items-center gap-2.5 text-xl font-semibold tracking-tight">
          <IrMark size={32} className="text-ink" />
          Iridium
        </h1>

        <form
          className="flex w-full flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            login();
          }}
        >
          {typing ? (
            <div className="g-fade flex h-10 items-center gap-1 rounded-lg bg-fill pr-1">
              <input
                ref={field}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  clipboardKeys(e, setAddress);
                  if (e.key === "Escape" && !none) setAdding(false);
                }}
                placeholder="服务器地址，如 ir.example.com"
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="url"
                className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none select-text placeholder:text-ink-3"
              />
              {!none && (
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="g-press h-8 shrink-0 rounded-md px-2 text-xs text-ink-3 hover:text-ink"
                >
                  取消
                </button>
              )}
            </div>
          ) : (
            <Menu.Root>
              <Menu.Trigger className="g-press flex h-10 w-full items-center gap-2 rounded-lg bg-fill px-3 text-left text-sm data-popup-open:bg-fill-2">
                <span className="min-w-0 flex-1 truncate">{host}</span>
                <ChevronsUpDown size={14} className="shrink-0 text-ink-3" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner
                  side="bottom"
                  align="start"
                  sideOffset={6}
                  className="z-50 w-(--anchor-width)"
                >
                  <Menu.Popup className="g-unfold glass thick float rounded-lg p-1.5 text-ink outline-none">
                    {servers?.map((s) => (
                      <Menu.Item
                        key={s.url}
                        onClick={() => (
                          setCurrent(s.url),
                          setNote(null),
                          ask("ir:select:" + s.url)
                        )}
                        className={ITEM}
                      >
                        <span className="grid w-4 shrink-0 place-items-center text-ink-2">
                          {s.url === current && (
                            <Check size={14} strokeWidth={2.5} />
                          )}
                        </span>
                        <span className="min-w-0 truncate">{s.host}</span>
                      </Menu.Item>
                    ))}
                    <div className="mx-1 my-1.5 border-t border-edge" />
                    <Menu.Item
                      onClick={() => (setAdding(true), setNote(null))}
                      className={ITEM}
                    >
                      <Plus size={15} className="w-4 shrink-0 text-ink-2" />
                      添加服务器
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          )}
          <button
            type="submit"
            disabled={busy && !note?.error}
            className="g-press flex h-10 items-center justify-center gap-2 rounded-lg bg-ink text-sm font-medium text-paper disabled:opacity-80"
          >
            {busy && !note?.error && (
              <LoaderCircle size={15} className="animate-spin" />
            )}
            用 Passkey 登录
          </button>
        </form>
        <p
          className={cn(
            "m-0 mt-3 min-h-5 text-xs",
            note?.error ? "text-err" : "text-ink-3",
          )}
          role="status"
        >
          {note?.text}
        </p>
      </div>
    </main>
  );
}
