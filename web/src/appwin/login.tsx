// The app's own page (docs/app.md "登录"): Iridium's mark and name at the top left; in the middle
// the Iridiums in the app's list, one under another: one logged in to with who the window is
// there (its face, its name), pressed to go in; another with 使用浏览器登录 (the passkey is used
// in the system's browser); a row to add one.
import { ChevronRight, LoaderCircle, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn, IrMark } from "../ui";
import { ask, clipboardKeys, onAnswer, whenReady } from "./bridge";

type Server = {
  url: string;
  host: string;
  loggedIn: boolean;
  name?: string;
  avatar?: string;
};
type Note = { text: string; error?: boolean; server?: string };

export function Login() {
  const [servers, setServers] = useState<Server[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(""); // the server being logged in to; "+" one typed
  const [note, setNote] = useState<Note | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stop = onAnswer((d) => {
      if (Array.isArray(d.servers)) {
        setServers(d.servers as Server[]);
        if (d.added) (setAdding(false), setAddress(""));
      }
      const server = typeof d.server === "string" ? d.server : undefined;
      if (typeof d.code === "string")
        setNote({ text: `在浏览器中核对代码 ${d.code} 后允许`, server });
      if (typeof d.error === "string")
        (setBusy(""), setNote({ text: d.error, error: true, server }));
    });
    whenReady(() => ask("ir:hello"));
    return stop;
  }, []);

  const none = servers !== null && servers.length === 0;
  const typing = adding || none;
  useEffect(() => {
    if (typing) field.current?.focus();
  }, [typing]);

  const login = (to: string, key: string) => {
    if (busy) return;
    if (!to) return setNote({ text: "填写服务器地址", error: true });
    setBusy(key);
    setNote(null);
    if (!ask("ir:login:" + to))
      (setBusy(""), setNote({ text: "无法连接应用", error: true }));
  };

  return (
    <div className="h-full bg-paper text-ink select-none [&_*:focus-visible]:outline-none">
      {/* The mark and the name at the page's top left (kumo, 2026-11-20). */}
      <header className="fixed top-5 left-6 flex items-center gap-2.5 text-lg font-semibold tracking-tight">
        <IrMark size={28} className="text-ink" />
        Iridium
      </header>
      <main
        className={cn(
          "grid h-full place-items-center",
          servers === null && "invisible",
        )}
      >
        <div className="flex w-[min(360px,calc(100vw-32px))] flex-col gap-1">
          {servers?.map((s) => {
            const mine = busy === s.url;
            const said = note && note.server === s.url ? note : null;
            return (
              <div key={s.url} className="group flex flex-col">
                <div className="flex items-center gap-3 rounded-lg px-2 py-2 has-[button[data-go]:hover]:bg-fill">
                  <Face s={s} />
                  <button
                    type="button"
                    data-go={s.loggedIn || undefined}
                    disabled={!s.loggedIn}
                    onClick={() => ask("ir:open:" + s.url)}
                    className="flex min-w-0 flex-1 flex-col items-start text-left disabled:cursor-default"
                  >
                    <span className="max-w-full truncate text-sm font-medium">
                      {s.loggedIn && s.name ? s.name : s.host}
                    </span>
                    {s.loggedIn && s.name && (
                      <span className="max-w-full truncate text-xs text-ink-3">
                        {s.host}
                      </span>
                    )}
                  </button>
                  {s.loggedIn ? (
                    <ChevronRight size={16} className="shrink-0 text-ink-3" />
                  ) : (
                    <button
                      type="button"
                      disabled={!!busy && !mine}
                      onClick={() => login(s.url, s.url)}
                      className="g-press flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-ink px-3 text-xs font-medium text-paper disabled:opacity-40"
                    >
                      {mine && (
                        <LoaderCircle size={13} className="animate-spin" />
                      )}
                      使用浏览器登录
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="移除"
                    onClick={() => ask("ir:remove:" + s.url)}
                    className="g-press -mr-1 grid size-6 shrink-0 place-items-center rounded-md text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-fill hover:text-ink"
                  >
                    <X size={13} />
                  </button>
                </div>
                {said && (
                  <p
                    className={cn(
                      "m-0 px-2 pb-1 pl-[3.25rem] text-xs",
                      said.error ? "text-err" : "text-ink-3",
                    )}
                  >
                    {said.text}
                  </p>
                )}
              </div>
            );
          })}

          {typing ? (
            <form
              className="g-fade mt-1 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                login(address.trim(), "+");
              }}
            >
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
                className="h-10 rounded-lg bg-fill px-3 text-sm outline-none select-text placeholder:text-ink-3"
              />
              <button
                type="submit"
                disabled={busy === "+"}
                className="g-press flex h-10 items-center justify-center gap-2 rounded-lg bg-ink text-sm font-medium text-paper disabled:opacity-80"
              >
                {busy === "+" && (
                  <LoaderCircle size={15} className="animate-spin" />
                )}
                使用浏览器登录
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => (setAdding(true), setNote(null))}
              className="g-press flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-2 hover:bg-fill hover:text-ink"
            >
              <span className="grid size-9 place-items-center">
                <Plus size={16} />
              </span>
              添加服务器
            </button>
          )}
          {note && !note.server && (
            <p
              className={cn(
                "m-0 mt-2 text-xs",
                note.error ? "text-err" : "text-ink-3",
              )}
            >
              {note.text}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

/** Who the window is at s (its face), else the server's first letter. */
function Face({ s }: { s: Server }) {
  if (s.loggedIn && s.avatar)
    return (
      <img
        src={s.avatar}
        alt=""
        draggable={false}
        className="size-9 shrink-0 rounded-full object-cover"
      />
    );
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-sm font-medium text-ink-2 uppercase">
      {(s.loggedIn && s.name ? s.name : s.host).slice(0, 1)}
    </span>
  );
}
