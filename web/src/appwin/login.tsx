// The app's own pages (docs/app.md "应用页面"; kumo, 2026-11-22: two things, two places).
//  - Login, the picker: a small upright window with the Iridiums. First, who (a face, a name,
//    开始: this computer's own Iridium); then 服务器: 此电脑 (its switch runs it and no more;
//    公网访问 under it), each Iridium (pressed, its window comes and the picker goes; the one
//    used last ticked, as the web app's lists tick theirs), 添加服务器 (pressed, a field).
//  - Control, the popover under the key at an Iridium page's top right: 授权操作 alone, the same
//    from every window: each Iridium logged in to, its link and switch, › to what it may do here;
//    服务器 opens the picker.
// A part is drawn once its state is there, never before.
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  LoaderCircle,
  Monitor,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Agent } from "../api/types.gen";
import { Crop } from "../profile";
import {
  agentName,
  cn,
  CopyKey,
  FaceChangeOver,
  IconKey,
  IrMark,
  Logo,
  MAC,
  SureKey,
  Switch,
} from "../ui";
import { ask, clipboardKeys, followTheme, onAnswer, whenReady } from "./bridge";
import { Fold, useFolding } from "./fold";

type Link = { up: boolean; rtt?: number; since: string };
type Server = {
  url: string;
  host: string;
  loggedIn: boolean;
  name?: string;
  avatar?: string;
  local?: boolean;
  status?: string; // this computer's own: 运行中, 启动中…
  joined?: boolean;
  shell?: boolean;
  roots?: string[];
  agentsOff?: string[] | null;
  link?: Link;
  said?: string;
};
type Me = { name?: string; avatar?: string };
type Pub = {
  busy: boolean;
  note: string;
  link: string;
  invite: string;
  error: string;
};
type State = {
  servers: Server[];
  current?: string; // the Iridium the window in front shows
  me?: Me;
  sysName?: string;
  agents?: string[];
  server?: boolean;
  public?: boolean;
  publicState?: Pub;
  publicAddress?: string;
};
type Note = { text: string; error?: boolean; server?: string };
type Part = "who" | "servers";

const FADE = 160; // ms, out then in

export function Login() {
  const [st, setSt] = useState<State | null>(null);
  const [part, setPart] = useState<Part | null>(
    location.hash === "#servers" ? "servers" : null,
  );
  const [me, setMe] = useState<Me>({});
  const [busy, setBusy] = useState(""); // a server being logged in to; "+" one typed; "local"
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    const stop = onAnswer((d) => {
      followTheme(d);
      if (Array.isArray(d.servers)) {
        const s = d as unknown as State;
        setSt(s);
        if (s.me) setMe((m) => ({ ...s.me, ...m }));
        setPart((p) => p ?? (s.servers.length === 0 ? "who" : "servers"));
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

  const go = (p: Part) => (setNote(null), setPart(p));
  const login = (to: string, key: string) => {
    if (busy || !to) return;
    setBusy(key);
    setNote(null);
    if (!ask("ir:login:" + to))
      (setBusy(""), setNote({ text: "无法连接应用", error: true }));
  };
  const keepMe = (m: Me) => (setMe(m), ask("ir:me:" + JSON.stringify(m)));

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
          "no-bar flex h-full flex-col items-center overflow-y-auto",
          part === "who" && "justify-center",
        )}
      >
        {st && part && (
          <Swap id={part}>
            <div
              className={cn(
                "flex w-[min(380px,calc(100vw-24px))] flex-col",
                part === "who" ? "py-16" : "pt-24 pb-6",
              )}
            >
              {part === "who" ? (
                <Who
                  me={me}
                  setMe={setMe}
                  keepMe={keepMe}
                  sysName={st.sysName ?? ""}
                  entering={
                    busy === "local" ||
                    st.servers.some((s) => s.local && s.status === "启动中")
                  }
                  note={note}
                  enter={() => {
                    setBusy("local");
                    setNote(null);
                    ask(
                      "ir:enter:" +
                        JSON.stringify({
                          ...me,
                          name: me.name?.trim() || st.sysName,
                        }),
                    );
                  }}
                  more={() => (
                    keepMe({ ...me, name: me.name?.trim() ?? "" }),
                    go("servers")
                  )}
                />
              ) : (
                <Servers
                  st={st}
                  busy={busy}
                  note={note}
                  login={login}
                  back={st.servers.length === 0 ? () => go("who") : undefined}
                />
              )}
            </div>
          </Swap>
        )}
      </main>
    </div>
  );
}

/** The part shown: when id changes, the old one fades out, then the new one fades in. */
function Swap({ id, children }: { id: string; children: ReactNode }) {
  const [shown, setShown] = useState({ id, children });
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (id === shown.id) return setShown({ id, children });
    setOut(true);
    const t = setTimeout(
      () => (setShown({ id, children }), setOut(false)),
      FADE,
    );
    return () => clearTimeout(t);
  }, [id, children]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      key={shown.id}
      className={cn(
        "transition-opacity ease-(--ease-out)",
        out ? "opacity-0" : "g-fade opacity-100",
      )}
      style={{ transitionDuration: `${FADE}ms` }}
    >
      {shown.children}
    </div>
  );
}

function Who({
  me,
  setMe,
  keepMe,
  sysName,
  entering,
  note,
  enter,
  more,
}: {
  me: Me;
  setMe: (m: Me) => void;
  keepMe: (m: Me) => void;
  sysName: string;
  entering: boolean;
  note: Note | null;
  enter: () => void;
  more: () => void;
}) {
  const [picture, setPicture] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const drop = () =>
    setPicture((old) => (old && URL.revokeObjectURL(old), null));
  return (
    <>
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
              onCancel={drop}
              onDone={(blob) => {
                const r = new FileReader();
                r.onload = () => (
                  keepMe({ ...me, avatar: String(r.result) }),
                  drop()
                );
                r.readAsDataURL(blob);
              }}
            />
          )}
        </Fold>
        <form
          className="flex w-full flex-col gap-2"
          onSubmit={(e) => (e.preventDefault(), !entering && enter())}
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
            {entering && <LoaderCircle size={15} className="animate-spin" />}
            开始
          </button>
        </form>
        <Fold state={note && !note.server ? "in" : "out"}>
          <p
            className={cn(
              "m-0 text-center text-xs",
              note?.error ? "text-err" : "text-ink-3",
            )}
          >
            {note?.text}
          </p>
        </Fold>
      </div>
      <Row
        icon={<Plus size={16} />}
        title="添加服务器"
        onClick={more}
        end={<ChevronRight size={16} className="text-ink-3" />}
      />
    </>
  );
}

/** A row of the app's lists: a face or an icon, a name, a second line, what is at its right. The
 *  rows are all of one height (docs/前端设计规范.md "行高一致"). */
function Row({
  icon,
  title,
  sub,
  end,
  onClick,
  tone,
}: {
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  end?: ReactNode;
  onClick?: () => void;
  tone?: string;
}) {
  const body = (
    <>
      <span className="grid size-9 shrink-0 place-items-center">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate text-sm font-medium", tone)}>
          {title}
        </span>
        {sub !== undefined && (
          <span className="truncate text-xs text-ink-3">{sub}</span>
        )}
      </span>
    </>
  );
  return (
    <div
      className={cn(
        "group flex min-h-13 items-center gap-1 rounded-md pr-2",
        onClick && "hover:bg-fill",
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="g-press flex min-w-0 flex-1 items-center gap-3 py-2 pl-2 text-left"
        >
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-2">
          {body}
        </span>
      )}
      {end && <span className="flex shrink-0 items-center gap-2">{end}</span>}
    </div>
  );
}

const DOT = {
  on: "var(--plus)",
  slow: "var(--need)",
  away: "var(--err)",
  none: "var(--ink-4)",
};

/** A join's link as its row says it: a lamp and its words. */
function linkOf(s: Server): { dot: string; text: string } {
  if (!s.joined) return { dot: DOT.none, text: "未授权" };
  const l = s.link;
  if (l?.up)
    return { dot: DOT.on, text: l.rtt ? `已连接 ${l.rtt} ms` : "已连接" };
  // No record of it yet (just granted, the runtime starting), or one without a time: 连接中.
  const since = l ? Date.parse(l.since) : NaN;
  const mins = since > 0 ? Math.floor((Date.now() - since) / 60000) : 0;
  if (mins < 1) return { dot: DOT.slow, text: "连接中" };
  return {
    dot: DOT.away,
    text:
      mins < 60 ? `断开 ${mins} 分钟` : `断开 ${Math.floor(mins / 60)} 小时`,
  };
}

function Lamp({ color }: { color: string }) {
  return (
    <span
      className="mr-1.5 inline-block size-1.5 rounded-full align-middle"
      style={{ background: color }}
    />
  );
}

function Face({ s }: { s: Server }) {
  if (s.loggedIn && s.avatar)
    return (
      <img
        src={s.avatar}
        alt=""
        draggable={false}
        className="size-9 rounded-full object-cover"
      />
    );
  return (
    <span className="grid size-9 place-items-center rounded-full bg-fill text-sm font-medium text-ink-2 uppercase">
      {(s.loggedIn && s.name ? s.name : s.host).slice(0, 1)}
    </span>
  );
}

/** The one ticked: the Iridium used last, as the web app's lists tick theirs. */
const Tick = () => <Check size={15} className="mr-1.5 shrink-0 text-ink-2" />;

/** The picker's list: 此电脑, each Iridium, 添加服务器. */
function Servers({
  st,
  busy,
  note,
  login,
  back,
}: {
  st: State;
  busy: string;
  note: Note | null;
  login: (to: string, key: string) => void;
  back?: () => void;
}) {
  const local = st.servers.find((s) => s.local);
  const remote = st.servers.filter((s) => !s.local);
  const rows = useFolding(remote, (s) => s.url);
  const on = !!local && st.server !== false;
  const p = st.publicState;
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (busy === "" && !note?.error) (setAddress(""), setAdding(false));
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const mineOf = (url?: string) =>
    note && url && note.server === url ? note : null;
  const localNote = mineOf(local?.url);

  return (
    <>
      {back && (
        <button
          type="button"
          onClick={back}
          className="g-press mb-2 flex items-center gap-1 self-start rounded-md px-1 py-1 text-sm text-ink-2 hover:text-ink"
        >
          <ChevronLeft size={16} />
          返回
        </button>
      )}

      <Heading>服务器</Heading>
      <Row
        icon={
          <span className="grid size-9 place-items-center rounded-full bg-fill text-ink-2">
            <Monitor size={16} />
          </span>
        }
        title="此电脑"
        sub={
          localNote ? (
            <span className={localNote.error ? "text-err" : undefined}>
              {localNote.text}
            </span>
          ) : on ? (
            (local?.status ?? "运行中")
          ) : (
            "已停止"
          )
        }
        onClick={local && on ? () => ask("ir:open:" + local.url) : undefined}
        end={
          <>
            {on && st.current === local?.url && <Tick />}
            <Switch
              label="此电脑"
              on={on}
              onChange={(v) => ask("ir:server:" + (v ? "on" : "off"))}
            />
          </>
        }
      />
      <Fold state={on ? "in" : "out"}>
        <Row
          icon={<span />}
          title="公网访问"
          sub={p?.busy && p.note ? p.note : st.publicAddress || "未开启"}
          end={
            <>
              {p?.busy && (
                <LoaderCircle size={14} className="animate-spin text-ink-3" />
              )}
              <Switch
                label="公网访问"
                on={!!st.public}
                disabled={!!p?.busy}
                onChange={(v) => ask("ir:public:" + (v ? "on" : "off"))}
              />
            </>
          }
        />
        <Fold state={p?.link ? "in" : "out"}>
          <Row
            icon={<span />}
            title="Cloudflare 授权"
            sub={p?.link}
            end={p?.link && <CopyKey text={p.link} />}
          />
        </Fold>
        <Fold state={p?.invite ? "in" : "out"}>
          <Row
            icon={<span />}
            title="邀请"
            sub={p?.invite}
            end={p?.invite && <CopyKey text={p.invite} />}
          />
        </Fold>
        <Fold state={p?.error ? "in" : "out"}>
          <Row icon={<span />} title={p?.error} tone="text-err" />
        </Fold>
      </Fold>
      {rows.map(({ item: s, key, state }) => {
        const mine = mineOf(s.url);
        return (
          <Fold key={key} state={state}>
            <Row
              icon={<Face s={s} />}
              title={s.loggedIn && s.name ? s.name : s.host}
              sub={
                mine ? (
                  <span className={mine.error ? "text-err" : undefined}>
                    {mine.text}
                  </span>
                ) : s.loggedIn ? (
                  s.host
                ) : (
                  "未登录"
                )
              }
              onClick={() =>
                s.loggedIn ? ask("ir:open:" + s.url) : login(s.url, s.url)
              }
              end={
                busy === s.url ? (
                  <LoaderCircle
                    size={16}
                    className="mr-1.5 animate-spin text-ink-3"
                  />
                ) : (
                  <>
                    {/* 移除: there as the row is pointed at (the app's window is a computer's). */}
                    <span className="opacity-0 transition-opacity duration-(--dur-1) group-hover:opacity-100 focus-within:opacity-100">
                      <SureKey
                        label="移除"
                        sure="确认移除"
                        run={() => ask("ir:remove:" + s.url)}
                        className="size-7"
                      >
                        <Trash2 size={14} />
                      </SureKey>
                    </span>
                    {st.current === s.url && <Tick />}
                  </>
                )
              }
            />
          </Fold>
        );
      })}

      {/* 添加服务器: pressed, a field in its place for an address or an invite link; a paste is
          handled as it lands. No field waits with the focus in it (kumo, 2026-11-22). */}
      {adding ? (
        <form
          className="flex min-h-13 items-center gap-3 rounded-md pr-2 pl-2"
          onSubmit={(e) => (e.preventDefault(), login(address.trim(), "+"))}
        >
          <span className="grid size-9 shrink-0 place-items-center text-ink-2">
            <Plus size={16} />
          </span>
          <input
            ref={field}
            autoFocus
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => !address.trim() && busy !== "+" && setAdding(false)}
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
              if (e.key === "Escape") (setAddress(""), setAdding(false));
            }}
            placeholder="服务器地址或邀请链接"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="url"
            className="h-9 min-w-0 flex-1 rounded-md bg-fill px-2.5 text-sm outline-none select-text placeholder:text-ink-3"
          />
          {busy === "+" && (
            <LoaderCircle
              size={16}
              className="shrink-0 animate-spin text-ink-3"
            />
          )}
        </form>
      ) : (
        <Row
          icon={<Plus size={16} className="text-ink-2" />}
          title={<span className="font-normal text-ink-2">添加服务器</span>}
          onClick={() => setAdding(true)}
        />
      )}
      <Fold state={note && !note.server ? "in" : "out"}>
        <p
          className={cn(
            "m-0 px-2 pt-1 pl-14 text-xs",
            note?.error ? "text-err" : "text-ink-3",
          )}
        >
          {note?.text}
        </p>
      </Fold>
    </>
  );
}

/** The control's list, 授权操作: the Iridiums this computer lets work here, as many as wanted,
 *  each with its link and its switch; › to what it may do here. Those not logged in to are not
 *  here: nothing can be granted to them yet. Last, 服务器: the picker. */
function Grants({ st, open }: { st: State; open: (s: Server) => void }) {
  const rows = useFolding(
    st.servers.filter((s) => !s.local && s.loggedIn),
    (s) => s.url,
  );
  return (
    <>
      <Heading>授权操作</Heading>
      {rows.length === 0 && (
        <p className="m-0 px-2.5 py-3 text-sm text-ink-3">无已登录的服务器</p>
      )}
      {rows.map(({ item: s, key, state }) => {
        const l = linkOf(s);
        return (
          <Fold key={key} state={state}>
            <Row
              icon={<Face s={s} />}
              title={s.name || s.host}
              sub={
                <>
                  <Lamp color={l.dot} />
                  {l.text}
                </>
              }
              end={
                <>
                  <Switch
                    label={"授权操作 " + s.host}
                    on={!!s.joined}
                    onChange={(v) =>
                      ask(
                        "ir:terms:" + JSON.stringify({ url: s.url, joined: v }),
                      )
                    }
                  />
                  <IconKey label={s.host} onClick={() => open(s)}>
                    <ChevronRight size={16} />
                  </IconKey>
                </>
              }
            />
          </Fold>
        );
      })}
      <div className="mx-2.5 my-1 h-px bg-edge" />
      <Row
        icon={<Monitor size={16} className="text-ink-2" />}
        title={<span className="font-normal">服务器</span>}
        onClick={() => ask("ir:picker")}
        end={<ChevronRight size={16} className="mr-2 text-ink-3" />}
      />
    </>
  );
}

/** A list's title in a popover, as the web app's (create.tsx). */
function Heading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("m-0 px-2.5 pt-1.5 pb-1 text-xs text-ink-3", className)}>
      {children}
    </p>
  );
}

/** One server's own page: 授权操作, then what it may do here; 移除. */
function ServerPage({
  s,
  agents,
  back,
}: {
  s?: Server;
  agents: string[];
  back: () => void;
}) {
  if (!s) return null;
  const terms = (t: object) =>
    ask("ir:terms:" + JSON.stringify({ url: s.url, ...t }));
  const roots = s.roots ?? [];
  const off = s.agentsOff ?? [];
  const l = linkOf(s);
  return (
    <>
      <button
        type="button"
        onClick={back}
        className="g-press mb-2 flex items-center gap-1 self-start rounded-md px-1 py-1 text-sm text-ink-2 hover:text-ink"
      >
        <ChevronLeft size={16} />
        返回
      </button>
      <Row
        icon={<Face s={s} />}
        title={s.loggedIn && s.name ? s.name : s.host}
        sub={
          <>
            <Lamp color={l.dot} />
            {l.text}
          </>
        }
      />
      <div className="mt-4" />
      <Row
        icon={<span />}
        title="授权操作"
        end={
          <Switch
            label="授权操作"
            on={!!s.joined}
            onChange={(v) => terms({ joined: v })}
          />
        }
      />
      <Fold state={s.joined ? "in" : "out"}>
        <Row
          icon={<span />}
          title="命令行"
          end={
            <Switch
              label="命令行"
              on={!!s.shell}
              onChange={(v) => terms({ shell: v })}
            />
          }
        />
        {agents.map((a) => (
          <Row
            key={a}
            icon={<Logo agent={a as Agent} size={16} />}
            title={agentName(a as Agent)}
            end={
              <Switch
                label={agentName(a as Agent)}
                on={!off.includes(a)}
                onChange={(v) => terms({ agents: { [a]: v } })}
              />
            }
          />
        ))}
        <Row
          icon={<span />}
          title="文件夹"
          sub={roots.length ? `${roots.length} 个` : "全部"}
          end={
            <IconKey
              label="添加文件夹"
              onClick={() => ask("ir:pickroot:" + s.url)}
            >
              <FolderPlus size={15} />
            </IconKey>
          }
        />
        {roots.map((r) => (
          <Row
            key={r}
            icon={<span />}
            title={<span className="font-normal text-ink-2">{r}</span>}
            end={
              <SureKey
                label="移除"
                sure="确认移除"
                run={() =>
                  roots.length > 1
                    ? terms({ roots: roots.filter((x) => x !== r) })
                    : terms({ all: true })
                }
                className="size-7"
              >
                <Trash2 size={14} />
              </SureKey>
            }
          />
        ))}
      </Fold>
    </>
  );
}

/** The control (internal/desktop/control.go): the popover under the key at an Iridium page's top
 *  right, in the app's own window, made ahead and hidden, its state kept: opened, it unfolds whole
 *  out of the key's corner (g-unfold, as PopSurface's), folds back as it is put away. Drawn as the
 *  web app's popovers (glass thick float rounded-lg), the glass solid: there is no page under it in
 *  this window to blur. Its height glides (Tall) as a server's page slides in (g-slide) and back.
 *  Esc or a press outside the panel puts it away. */
export function Control() {
  const [st, setSt] = useState<State | null>(null);
  const [at, setAt] = useState<string | null>(null); // a server's page, else the list
  const [shown, setShown] = useState<"in" | "out" | "gone">("gone");
  const back = useRef(false);
  const [moved, setMoved] = useState(false); // gone to a page since it opened: that one slides in
  useEffect(() => {
    const stop = onAnswer((d) => {
      followTheme(d);
      if (Array.isArray(d.servers)) setSt(d as unknown as State);
      if (d.open === true) {
        setAt(null);
        setMoved(false);
        setShown("gone");
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setShown("in")),
        );
      }
      if (d.close === true) setShown("out");
    });
    whenReady(() => ask("ir:hello"));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && ask("ir:close");
    addEventListener("keydown", esc);
    return () => (stop(), removeEventListener("keydown", esc));
  }, []);
  const go = (to: string | null) => {
    back.current = to === null;
    setMoved(true);
    setAt(to);
  };
  return (
    <div
      className="h-full px-8 pt-2 select-none [&_*:focus-visible]:outline-none"
      onPointerDown={(e) => e.target === e.currentTarget && ask("ir:close")}
    >
      <div
        data-starting-style={shown === "gone" || undefined}
        data-ending-style={shown === "out" || undefined}
        className="g-unfold glass thick float rounded-lg p-1.5 text-ink"
        style={
          {
            "--transform-origin": "100% 0",
            background: "var(--glass-thick-solid)",
            backdropFilter: "none",
            WebkitBackdropFilter: "none",
          } as React.CSSProperties
        }
      >
        {st && (
          <Tall>
            <div
              key={at ?? "list"}
              data-dir={back.current ? "back" : undefined}
              className={cn("flex flex-col", moved && "g-slide")}
            >
              {at === null ? (
                <Grants st={st} open={(s) => go(s.url)} />
              ) : (
                <ServerPage
                  s={st.servers.find((s) => s.url === at)}
                  agents={st.agents ?? []}
                  back={() => go(null)}
                />
              )}
            </div>
          </Tall>
        )}
      </div>
    </div>
  );
}

/** As tall as what is in it, gliding to it (create.tsx Tall); at most the control's room, the
 *  rest scrolled. */
function Tall({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number>();
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      className="no-bar max-h-[628px] overflow-x-hidden overflow-y-auto transition-[height] duration-(--dur-3) ease-(--ease-out) motion-reduce:transition-none"
      style={{ height: h }}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}
