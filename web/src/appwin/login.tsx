// The app's own page (docs/app.md "第一次打开"), one page, two parts that fold into each other
// (kumo, 2026-11-22):
//  - who: a face (a grey figure till one is chosen, pressed to choose and crop one), a name, and 进入:
//    this computer's own Iridium, started and shown, its host given that name and face; under them
//    添加服务器.
//  - servers: the Iridiums in the app's list (one logged in to pressed to go in, another to log in
//    from the system's browser, its menu to remove) and a row to paste an address or an invite link
//    into: handled as it lands (an invite registered in the browser, an address logged in to).
// Opened with #servers (添加服务器 from the window's top right or the tray), servers it is.
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Monitor,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRowMenu } from "../apps";
import { Crop } from "../profile";
import { cn, FaceChangeOver, IrMark, MAC } from "../ui";
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
type Me = { name?: string; avatar?: string };
type Note = { text: string; error?: boolean; server?: string };

export function Login() {
  const [servers, setServers] = useState<Server[] | null>(null);
  const [me, setMe] = useState<Me>({});
  const [sysName, setSysName] = useState("");
  const [part, setPart] = useState<"who" | "servers" | null>(
    location.hash === "#servers" ? "servers" : null,
  );
  const rows = useFolding(servers, (s) => s.url);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(""); // the server being logged in to; "+" one typed
  const [note, setNote] = useState<Note | null>(null);
  const [picture, setPicture] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stop = onAnswer((d) => {
      followTheme(d);
      if (Array.isArray(d.servers)) {
        const list = d.servers as Server[];
        setServers(list);
        if (d.me && typeof d.me === "object")
          setMe((m) => ({ ...(d.me as Me), ...m }));
        if (typeof d.sysName === "string") setSysName(d.sysName);
        // The first draw: who, while nothing is in the list; else the servers.
        setPart((p) => p ?? (list.length === 0 ? "who" : "servers"));
        if (d.added) setAddress("");
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

  useEffect(() => {
    if (part === "servers") field.current?.focus();
  }, [part]);

  const keepMe = (m: Me) => (setMe(m), ask("ir:me:" + JSON.stringify(m)));
  const local = servers?.find((s) => s.local);
  const entering = busy === "local" || local?.status === "启动中";

  const login = (to: string, key: string) => {
    if (busy) return;
    if (!to) return;
    setBusy(key);
    setNote(null);
    if (!ask("ir:login:" + to))
      (setBusy(""), setNote({ text: "无法连接应用", error: true }));
  };

  const enter = () => {
    if (entering) return;
    setBusy("local");
    setNote(null);
    ask(
      "ir:enter:" + JSON.stringify({ ...me, name: me.name?.trim() || sysName }),
    );
  };

  const toServers = () => {
    keepMe({ ...me, name: me.name?.trim() || "" });
    setNote(null);
    setPart("servers");
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
          part === null && "invisible",
        )}
      >
        <div className="flex w-[min(360px,calc(100vw-32px))] flex-col">
          {/* Who: folds shut as the servers fold open, and back. */}
          <Fold state={part === "who" ? "in" : "out"}>
            <div className="flex flex-col items-center gap-4 pb-6">
              <button
                type="button"
                aria-label="头像"
                onClick={() => file.current?.click()}
                className="group g-press relative grid size-22 place-items-center overflow-hidden rounded-full bg-fill text-ink-3"
              >
                {me.avatar ? (
                  <img
                    src={me.avatar}
                    alt=""
                    draggable={false}
                    className="size-full object-cover"
                  />
                ) : (
                  <UserRound size={44} strokeWidth={1.5} />
                )}
                <FaceChangeOver size={88} />
              </button>
              <input
                ref={file}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    setPicture(
                      (old) => (
                        old && URL.revokeObjectURL(old),
                        URL.createObjectURL(f)
                      ),
                    );
                  e.target.value = "";
                }}
              />
              <Fold state={picture ? "in" : "out"}>
                {picture && (
                  <Crop
                    src={picture}
                    onCancel={() =>
                      setPicture(
                        (old) => (old && URL.revokeObjectURL(old), null),
                      )
                    }
                    onDone={(blob) => {
                      const r = new FileReader();
                      r.onload = () => {
                        keepMe({ ...me, avatar: String(r.result) });
                        setPicture(
                          (old) => (old && URL.revokeObjectURL(old), null),
                        );
                      };
                      r.readAsDataURL(blob);
                    }}
                  />
                )}
              </Fold>
              <form
                className="flex w-full flex-col gap-2"
                onSubmit={(e) => (e.preventDefault(), enter())}
              >
                <input
                  value={me.name ?? ""}
                  onChange={(e) => setMe({ ...me, name: e.target.value })}
                  onBlur={() => keepMe(me)}
                  onKeyDown={(e) =>
                    clipboardKeys(e, (v) => setMe({ ...me, name: v }))
                  }
                  placeholder={sysName || "名字"}
                  aria-label="名字"
                  spellCheck={false}
                  autoComplete="name"
                  className="h-10 rounded-lg bg-fill px-3 text-center text-sm outline-none select-text placeholder:text-ink-3"
                />
                <button
                  type="submit"
                  disabled={entering}
                  className="g-press flex h-10 items-center justify-center gap-2 rounded-lg bg-ink text-sm font-medium text-paper disabled:opacity-80"
                >
                  {entering && (
                    <LoaderCircle size={15} className="animate-spin" />
                  )}
                  进入
                </button>
              </form>
              {note &&
                note.server === undefined &&
                busy === "" &&
                part === "who" && (
                  <p
                    className={cn(
                      "m-0 text-xs",
                      note.error ? "text-err" : "text-ink-3",
                    )}
                  >
                    {note.text}
                  </p>
                )}
            </div>
            <button
              type="button"
              onClick={toServers}
              className="g-press flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink-2 hover:bg-fill hover:text-ink"
            >
              <span className="grid size-9 place-items-center">
                <Plus size={16} />
              </span>
              <span className="flex-1 text-left">添加服务器</span>
              <ChevronRight size={16} className="text-ink-3" />
            </button>
          </Fold>

          {/* Servers. */}
          <Fold state={part === "servers" ? "in" : "out"}>
            <button
              type="button"
              onClick={() => (setNote(null), setPart("who"))}
              className="g-press mb-2 flex items-center gap-1 self-start rounded-md px-1 py-1 text-sm text-ink-2 hover:text-ink"
            >
              <ChevronLeft size={16} />
              返回
            </button>
            {rows.map(({ item: s, key, state }) => (
              <Fold key={key} state={state}>
                <div className="pb-1">
                  <ServerRow
                    s={s}
                    busy={
                      busy === s.url || (!!s.local && s.status === "启动中")
                    }
                    note={note && note.server === s.url ? note : null}
                    press={() =>
                      s.loggedIn ? ask("ir:open:" + s.url) : login(s.url, s.url)
                    }
                    remove={() => ask("ir:remove:" + s.url)}
                  />
                </div>
              </Fold>
            ))}
            {/* An address or an invite link, typed or pasted: a paste is handled as it lands. */}
            <form
              className="flex items-center gap-3 rounded-lg px-2 py-2 focus-within:bg-fill hover:bg-fill"
              onSubmit={(e) => (e.preventDefault(), login(address.trim(), "+"))}
            >
              <span className="grid size-9 shrink-0 place-items-center text-ink-2">
                <Plus size={16} />
              </span>
              <input
                ref={field}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onPaste={(e) => {
                  const v = e.clipboardData.getData("text").trim();
                  if (!v) return;
                  e.preventDefault();
                  setAddress(v);
                  login(v, "+");
                }}
                onKeyDown={(e) => {
                  clipboardKeys(
                    e,
                    (v) => (setAddress(v), v.trim() && login(v.trim(), "+")),
                  );
                  if (e.key === "Escape")
                    (setAddress(""), field.current?.blur());
                }}
                placeholder="服务器地址或邀请链接"
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="url"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none select-text placeholder:text-ink-3"
              />
              <button
                type="submit"
                aria-label="登录"
                disabled={busy === "+" || !address.trim()}
                className="g-press grid size-7 shrink-0 place-items-center rounded-md text-ink-3 enabled:hover:text-ink disabled:opacity-40"
              >
                {busy === "+" ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <ChevronRight size={16} />
                )}
              </button>
            </form>
            <Fold state={note && !note.server ? "in" : "out"}>
              <p
                className={cn(
                  "m-0 px-2 pt-1 pl-[3.75rem] text-xs",
                  note?.error ? "text-err" : "text-ink-3",
                )}
              >
                {note?.text}
              </p>
            </Fold>
          </Fold>
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
