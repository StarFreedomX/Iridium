// The app's own page (docs/app.md "登录"): Iridium's mark and name at the top left; in the middle
// the Iridiums in the app's list, one under another, all alike: one logged in to with who the
// window is there (its face, its name), pressed to go in; another pressed to log in from the
// system's browser, where the passkey is; its menu (right click, or held) to remove; a row to add one.
import {
  ChevronRight,
  LoaderCircle,
  Monitor,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRowMenu } from "../apps";
import { cn, IrMark, MAC } from "../ui";
import { ask, clipboardKeys, followTheme, onAnswer, whenReady } from "./bridge";
import { Fold, useFolding } from "./fold";

type Server = {
  url: string;
  host: string;
  loggedIn: boolean;
  name?: string;
  avatar?: string;
  local?: boolean; // this computer's own Iridium: status its state
  status?: string;
};
type Note = { text: string; error?: boolean; server?: string };

export function Login() {
  const [servers, setServers] = useState<Server[] | null>(null);
  const [hasLocal, setHasLocal] = useState(true);
  const rows = useFolding(servers, (s) => s.url);
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(""); // the server being logged in to; "+" one typed
  const [note, setNote] = useState<Note | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stop = onAnswer((d) => {
      followTheme(d);
      if (Array.isArray(d.servers)) {
        setServers(d.servers as Server[]);
        setHasLocal(d.hasLocal === true);
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
      <header
        className={cn(
          "fixed left-6 flex items-center gap-2.5 text-lg font-semibold tracking-tight",
          MAC ? "top-11" : "top-5",
        )}
      >
        <IrMark size={28} className="text-ink" />
        Iridium
      </header>
      <main
        className={cn(
          "grid h-full place-items-center",
          servers === null && "invisible",
        )}
      >
        <div className="flex w-[min(360px,calc(100vw-32px))] flex-col">
          {rows.map(({ item: s, key, state }) => (
            <Fold key={key} state={state}>
              <div className="pb-1">
                <ServerRow
                  s={s}
                  busy={busy === s.url || (!!s.local && s.status === "启动中")}
                  note={note && note.server === s.url ? note : null}
                  press={() =>
                    s.loggedIn ? ask("ir:open:" + s.url) : login(s.url, s.url)
                  }
                  remove={() => ask("ir:remove:" + s.url)}
                />
              </div>
            </Fold>
          ))}

          {/* This computer's own Iridium, started and shown (internal/desktop/local.go). */}
          <Fold state={hasLocal ? "out" : "in"}>
            <button
              type="button"
              onClick={() => (setNote(null), ask("ir:local"))}
              className="g-press flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-2 hover:bg-fill hover:text-ink"
            >
              <span className="grid size-9 place-items-center">
                <Monitor size={16} />
              </span>
              在本机运行 Iridium
            </button>
          </Fold>
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
      {s.local && !(s.loggedIn && s.avatar) ? (
        <Monitor size={16} />
      ) : (
        (s.loggedIn && s.name ? s.name : s.host).slice(0, 1)
      )}
    </span>
  );
}

/** One Iridium. Pressed: in, or logged in to from the browser (a turning ring the while). Its
 *  menu (a right click, or held on a touch screen; the web app's row menu) removes it, asking to be
 *  pressed again (docs/前端设计规范.md "确认在原处"). */
function ServerRow({
  s,
  busy,
  note,
  press,
  remove,
}: {
  s: Server;
  busy: boolean;
  note: Note | null;
  press: () => void;
  remove: () => void;
}) {
  const row = useRowMenu();
  return (
    <div className="flex flex-col" {...row.on}>
      <button
        type="button"
        onClick={press}
        className={cn(
          "g-press flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-fill",
          row.at && "bg-fill",
        )}
      >
        <Face s={s} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">
            {s.local ? "本机" : s.loggedIn && s.name ? s.name : s.host}
          </span>
          <span className="truncate text-xs text-ink-3">
            {s.local
              ? s.status
              : s.loggedIn && s.name
                ? s.host
                : s.loggedIn
                  ? ""
                  : "未登录"}
          </span>
        </span>
        {busy ? (
          <LoaderCircle
            size={16}
            className="shrink-0 animate-spin text-ink-3"
          />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-ink-3" />
        )}
      </button>
      {note && (
        <p
          className={cn(
            "m-0 px-2 pb-1 pl-[3.75rem] text-xs",
            note.error ? "text-err" : "text-ink-3",
          )}
        >
          {note.text}
        </p>
      )}
      {row.menu([
        {
          icon: <Trash2 size={15} />,
          label: "移除",
          sure: "确认移除",
          run: remove,
        },
      ])}
    </div>
  );
}
