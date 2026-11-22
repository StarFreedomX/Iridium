// The app's own page (docs/app.md "应用页面"), three parts, one shown at a time; the one leaving
// fades out, then the one coming fades in (kumo, 2026-11-22: no folding, no rising; timed):
//  - who (the first start): a face (a grey figure till chosen; pressed, choose and crop), a name,
//    开始: this computer's own Iridium, its host given that name and face; under them 添加服务器.
//  - servers, the app's control page (its key at an Iridium's top right): 此电脑 (on or off,
//    pressed to go in) and 公网访问; then 服务器, each a row with its link (已连接 32 ms, 断开 3 分钟,
//    未授权), pressed to go in, its › to its own page; last, a field to paste an address or an
//    invite link into, handled as it lands.
//  - one server's page: 授权操作, then (granted) 命令行, each agent, 文件夹; 移除.
// The page is drawn once its state is there (it fades in then), never before.
import {
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  LoaderCircle,
  Monitor,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
type Part = "who" | "servers" | { server: string };

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

  const key =
    typeof part === "object" && part ? "server:" + part.server : (part ?? "");
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
      <main className="grid h-full place-items-center overflow-y-auto">
        {st && part && (
          <Swap id={key}>
            <div className="flex w-[min(380px,calc(100vw-32px))] flex-col py-16">
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
              ) : part === "servers" ? (
                <Servers
                  st={st}
                  busy={busy}
                  note={note}
                  login={login}
                  open={(s) => go({ server: s.url })}
                  back={st.servers.length === 0 ? () => go("who") : undefined}
                />
              ) : (
                <ServerPage
                  s={st.servers.find((s) => s.url === part.server)}
                  agents={st.agents ?? []}
                  back={() => go("servers")}
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
    <div className="flex min-h-13 items-center gap-1 rounded-lg pr-2 hover:bg-fill">
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
  const mins = l ? Math.floor((Date.now() - Date.parse(l.since)) / 60000) : 0;
  if (!l || mins < 1) return { dot: DOT.slow, text: "连接中" };
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

function Servers({
  st,
  busy,
  note,
  login,
  open,
  back,
}: {
  st: State;
  busy: string;
  note: Note | null;
  login: (to: string, key: string) => void;
  open: (s: Server) => void;
  back?: () => void;
}) {
  const local = st.servers.find((s) => s.local);
  const cur = st.servers.find((s) => !s.local && s.url === st.current);
  const others = st.servers.filter((s) => !s.local && s.url !== cur?.url);
  const rows = useFolding(others, (s) => s.url);
  const on = !!local && st.server !== false;
  const p = st.publicState;
  const [address, setAddress] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (busy === "" && !note?.error) setAddress("");
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* The Iridium this window shows, first, with its 授权操作 at hand (kumo, 2026-11-22: the
          key is there to control this). */}
      {cur && (
        <>
          <Row
            icon={<Face s={cur} />}
            title={cur.loggedIn && cur.name ? cur.name : cur.host}
            sub={
              <>
                <Lamp color={linkOf(cur).dot} />
                {linkOf(cur).text}
              </>
            }
            end={
              <IconKey label={cur.host} onClick={() => open(cur)}>
                <ChevronRight size={16} />
              </IconKey>
            }
          />
          <Row
            icon={<span />}
            title="授权操作"
            end={
              <Switch
                label="授权操作"
                on={!!cur.joined}
                onChange={(v) =>
                  ask("ir:terms:" + JSON.stringify({ url: cur.url, joined: v }))
                }
              />
            }
          />
          <div className="h-4" />
        </>
      )}

      {/* 此电脑: this computer's own Iridium, and 公网访问 under it while it runs. */}
      <Row
        icon={
          <span className="grid size-9 place-items-center rounded-full bg-fill text-ink-2">
            <Monitor size={16} />
          </span>
        }
        title="此电脑"
        sub={on ? (local?.status ?? "运行中") : "已停止"}
        onClick={local && on ? () => ask("ir:open:" + local.url) : undefined}
        end={
          <Switch
            label="此电脑"
            on={on}
            onChange={(v) => ask("ir:server:" + (v ? "on" : "off"))}
          />
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

      <h2 className="m-0 mt-6 mb-1 px-2 text-xs font-medium text-ink-3">
        服务器
      </h2>
      {rows.map(({ item: s, key, state }) => {
        const l = linkOf(s);
        const mine = note && note.server === s.url ? note : null;
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
                ) : (
                  <>
                    <Lamp color={l.dot} />
                    {l.text}
                  </>
                )
              }
              onClick={() =>
                s.loggedIn ? ask("ir:open:" + s.url) : login(s.url, s.url)
              }
              end={
                busy === s.url ? (
                  <LoaderCircle size={16} className="animate-spin text-ink-3" />
                ) : (
                  <IconKey label={s.host} onClick={() => open(s)}>
                    <ChevronRight size={16} />
                  </IconKey>
                )
              }
            />
          </Fold>
        );
      })}

      {/* An address or an invite link, typed or pasted: a paste is handled as it lands. */}
      <form
        className="flex min-h-13 items-center gap-3 rounded-lg px-2 focus-within:bg-fill hover:bg-fill"
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
            if (e.key === "Escape") (setAddress(""), field.current?.blur());
          }}
          placeholder="粘贴服务器地址或邀请链接"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="url"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none select-text placeholder:text-ink-3"
        />
        {busy === "+" && (
          <LoaderCircle
            size={16}
            className="shrink-0 animate-spin text-ink-3"
          />
        )}
      </form>
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

/** One server's own page: 授权操作, then what it may do here; 在新窗口打开 (in the control); 移除. */
function ServerPage({
  s,
  agents,
  back,
  newWindow,
}: {
  s?: Server;
  agents: string[];
  back: () => void;
  newWindow?: () => void;
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
      <div className="mt-4" />
      {newWindow && (
        <Row
          icon={<Plus size={15} className="text-ink-3" />}
          title="在新窗口打开"
          tone="font-normal text-ink-2"
          onClick={newWindow}
        />
      )}
      <RemoveRow onRemove={() => (ask("ir:remove:" + s.url), back())} />
    </>
  );
}

/** 移除, pressed twice: the first press turns it red, 确认移除 (docs/前端设计规范.md "确认在原处"). */
function RemoveRow({ onRemove }: { onRemove: () => void }) {
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const t = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(t);
  }, [sure]);
  return (
    <Row
      icon={<Trash2 size={15} className={sure ? "text-err" : "text-ink-3"} />}
      title={sure ? "确认移除" : "移除"}
      tone={sure ? "text-err" : "font-normal text-ink-2"}
      onClick={() => (sure ? onRemove() : setSure(true))}
    />
  );
}

/** The control (internal/desktop/control.go): a popover under the key at an Iridium page's top
 *  right, the app's own window. Its servers, one's own page sliding in (g-slide, as a popover's
 *  pages do) with 返回; its height told to the app as it changes; Esc closes it. */
export function Control() {
  const [st, setSt] = useState<State | null>(null);
  const [at, setAt] = useState<string | null>(null); // a server's page, else the list
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stop = onAnswer((d) => {
      followTheme(d);
      if (Array.isArray(d.servers)) setSt(d as unknown as State);
      const server = typeof d.server === "string" ? d.server : undefined;
      if (typeof d.code === "string")
        setNote({ text: `在浏览器中核对代码 ${d.code} 后允许`, server });
      if (typeof d.error === "string")
        (setBusy(""), setNote({ text: d.error, error: true, server }));
    });
    whenReady(() => ask("ir:hello"));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && ask("ir:close");
    addEventListener("keydown", esc);
    return () => (stop(), removeEventListener("keydown", esc));
  }, []);
  // The window as tall as the panel (and its shadow's margin).
  const ready = st !== null;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const tell = () =>
      ask("ir:size:" + Math.ceil(el.getBoundingClientRect().height + 16));
    const ro = new ResizeObserver(tell);
    ro.observe(el);
    tell();
    return () => ro.disconnect();
  }, [ready]);
  const login = (to: string, key: string) => {
    if (busy || !to) return;
    setBusy(key);
    setNote(null);
    ask("ir:login:" + to);
  };
  if (!st) return null;
  return (
    <div className="p-2 select-none [&_*:focus-visible]:outline-none">
      <div
        ref={box}
        className="g-unfold flex max-h-[664px] flex-col overflow-y-auto rounded-lg bg-(--glass-thick-solid) p-2 text-ink shadow-[var(--shadow-float)]"
      >
        <div
          key={at ?? "list"}
          className={cn("flex flex-col", at !== null && "g-slide")}
        >
          {at === null ? (
            <Servers
              st={st}
              busy={busy}
              note={note}
              login={login}
              open={(s) => setAt(s.url)}
            />
          ) : (
            <ServerPage
              s={st.servers.find((s) => s.url === at)}
              agents={st.agents ?? []}
              back={() => setAt(null)}
              newWindow={() => ask("ir:newwin:" + at)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
