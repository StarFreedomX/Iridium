// Making a channel (kumo, 2026-11-25): no popover to line agents up in. The "+" of a group's or a
// folder's row makes a channel there with no agent yet and opens it, the + beside its members'
// key open on it (chat/channel/top.tsx): its agents are added there. The row's menu, or the "+"
// at the right button: 新建子文件夹, a name and 创建, the channel made in the folder made. A
// folder no listed group holds: the file browser's 在此新建 (filebrowser.tsx).
import { Popover } from "@base-ui/react/popover";
import { LoaderCircle } from "lucide-react";
import { cloneElement, useLayoutEffect, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import type { Agent, Workspace } from "./api/types.gen";
import { api } from "./api/client";
import { askAdd } from "./chat/channel/adding";
import { useMachines } from "./data";
import { t } from "./i18n";
import { agentsAt, type Machine } from "./machines";
import { errText, toast } from "./toast";
import { cn, PopSurface } from "./ui";

const join = (dir: string, name: string) => (dir.endsWith("/") || dir.endsWith("\\") ? dir + name : `${dir}/${name}`);
/** One folder's listing; prefetched before it is shown (the popover opening, a row hovered), so the
 *  picker opens and steps at its full height instead of a spinner springing open into the list. */
export const foldersQ = (path: string, machine?: string) => ({ queryKey: ["folders", machine ?? "", path], queryFn: () => api.folders(path, machine), retry: false, staleTime: 10_000 });

/** Its children's height, glided to as it changes (a folder of more or fewer folders): the popover
 *  grows and shrinks instead of jumping (the user, 2026-11-06). */
export function Tall({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return (
    <div className={cn("overflow-hidden transition-[height] duration-(--dur-3) ease-(--ease-out) motion-reduce:transition-none", className)} style={{ height: h }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

/** A subfolder's name as typed: trimmed, or null when it is none (empty, or a path, not a name). */
export const subName = (v: string) => {
  const n = v.trim();
  return n && n !== "." && n !== ".." && !/[/\\\0]/.test(n) ? n : null;
};

/** A channel made in cwd (at machine: a path there; none: here) with no agent yet: its id, the +
 *  beside its members' key asked to open on it; null (and said) when it was not made. */
export async function newChannelAt(cwd: string, machine?: string, workspace?: number): Promise<string | null> {
  try {
    // Every new chat is a channel: no agent of its own, its agents members of it.
    const { id } = await api.create({ agent: "" as Agent, cwd, ...(workspace ? { workspace } : {}), ...(machine ? { machine } : {}) });
    askAdd(id);
    return id;
  } catch (e) {
    toast(t("err.newSession"), { error: true, description: errText(e) });
    return null;
  }
}

/** Where a folder as the list writes it ("<machine>:<path>" at another) is: the path there and
 *  its machine; null (and said) when its machine is gone or not connected. */
function whereOf(path: string, ms: Machine[]): { cwd: string; machine?: string } | null {
  const r = agentsAt(path, ms);
  if (r === "gone") return toast(t("new.gone"), { error: true }), null;
  if (r === "here") return { cwd: path };
  if (!r.m.online) return toast(t("new.offline", { name: r.m.name }), { error: true }), null;
  return { cwd: r.cwd, machine: r.m.id };
}

/** A channel made in a folder of the list (newChannelAt), in its group. */
export async function newChannel(path: string, ms: Machine[], workspace?: number): Promise<string | null> {
  const at = whereOf(path, ms);
  return at && newChannelAt(at.cwd, at.machine, workspace);
}

/** The "+" of a group's or a folder's row. Pressed: a channel there, opened (opened). At the right
 *  button, or open set by the row's menu: 新建子文件夹, out of the key: a name and 创建 (Enter
 *  too); the folder is made where the row's is, the channel in it. */
export function NewHere({ w, trigger, open, setOpen, opened }: { w: Workspace; trigger: ReactElement; open: boolean; setOpen: (o: boolean) => void; opened: (id: string) => void }) {
  const machines = useMachines();
  const [key, setKey] = useState<HTMLElement | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [shown, setShown] = useState(open);
  if (open !== shown) {
    setShown(open);
    if (open) setName("");
  }
  const run = async (make: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await make();
      if (id) setOpen(false), opened(id);
    } finally {
      setBusy(false);
    }
  };
  const here = () => void run(() => newChannel(w.path, machines, w.id));
  const n = subName(name);
  const sub = () =>
    n &&
    void run(async () => {
      const at = whereOf(w.path, machines);
      if (!at) return null;
      try {
        await api.mkdir({ path: at.cwd, name: n, ...(at.machine ? { machine: at.machine } : {}) });
      } catch (e) {
        return toast(t("err.mkdir"), { error: true, description: errText(e) }), null;
      }
      return newChannelAt(join(at.cwd, n), at.machine, w.id);
    });
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {cloneElement(trigger as ReactElement<{ onClick?: (e: MouseEvent) => void; onContextMenu?: (e: MouseEvent) => void; ref?: (el: HTMLElement | null) => void; "data-popup-open"?: string }>, {
        ref: setKey,
        "data-popup-open": open ? "" : undefined,
        onClick: (e: MouseEvent) => (e.stopPropagation(), here()),
        onContextMenu: (e: MouseEvent) => (e.preventDefault(), e.stopPropagation(), setOpen(true)),
      })}
      <PopSurface anchor={key} side="bottom" align="end" initialFocus={box} finalFocus={false} className="w-[min(280px,calc(100vw-16px))] p-2.5">
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            sub();
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="px-0.5 text-xs text-ink-3">{t("new.subFolder")}</span>
            <input ref={box} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("new.subName")} autoComplete="off" spellCheck={false} className="h-8 w-full rounded-md bg-fill px-2.5 text-base text-ink outline-none placeholder:text-ink-4 pointer-coarse:h-10" />
          </label>
          <button type="submit" disabled={!n || busy} className={cn("g-press flex h-8 items-center justify-center gap-1.5 rounded-md bg-ink px-3 text-sm font-medium text-on-ink disabled:opacity-40 pointer-coarse:h-10")}>
            {busy && <LoaderCircle size={14} className="animate-spin" />}
            {t("role.create")}
          </button>
        </form>
      </PopSurface>
    </Popover.Root>
  );
}
