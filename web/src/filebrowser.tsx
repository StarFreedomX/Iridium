import { Dialog } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUp, Download, ExternalLink, FileText, Folder, House, Link2, LoaderCircle, RefreshCw } from "lucide-react";
import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, queryClient } from "./api/client";
import type { DirEntry } from "./api/types.gen";
import { size } from "./chat/files";
import { previewKind } from "./chat/preview-lib";
import { useMachines } from "./data";
import { t } from "./i18n";
import { cn, IconKey, Tip } from "./ui";

const preview = () => import("./chat/preview");
const PreviewBody = lazy(preview);
const filesQ = (machine: string, path: string) => ({
  queryKey: ["browse-files", machine, path],
  queryFn: ({ signal }: { signal: AbortSignal }) => api.browseFiles(path, machine, signal),
  staleTime: 10_000,
  retry: false,
});

export const prefetchDirectory = (machine: string, path: string) => queryClient.prefetchQuery(filesQ(machine, path));

const join = (dir: string, name: string) => dir.endsWith("/") ? dir + name : `${dir}/${name}`;
const startAt = (m?: { roots?: string[] }) => m?.roots?.[0] || "~";

function parent(dir: string) {
  if (!dir.startsWith("/") && !/^[A-Za-z]:\//.test(dir)) return "";
  const path = dir.replace(/\/+$/, "");
  if (!path || /^[A-Za-z]:$/.test(path) || /^\/\/[^/]+\/[^/]+$/.test(path)) return "";
  const up = path.slice(0, path.lastIndexOf("/")) || "/";
  return /^[A-Za-z]:$/.test(up) ? up + "/" : up;
}

const row = "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm pointer-coarse:h-11";
const action = "g-press grid size-8 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-fill hover:text-ink pointer-coarse:size-10";

function Loading() {
  return <div className="grid min-h-32 place-items-center text-ink-3" role="status" aria-label={t("msg.loading")}><LoaderCircle size={18} className="animate-spin" /></div>;
}

export default function FileBrowser({ machine: initialMachine, path: initialPath }: { machine: string; path: string }) {
  const machines = useMachines();
  const [machine, setMachine] = useState(initialMachine);
  const [path, setPath] = useState(initialPath);
  const [typed, setTyped] = useState<string | null>(null);
  const [file, setFile] = useState<DirEntry | null>(null);
  const folders = useQuery(filesQ(machine, path));
  const dir = folders.data?.path ?? path;
  const start = startAt(machines.find((m) => m.id === machine));
  const up = parent(dir);
  const list = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<HTMLButtonElement | null>(null);

  const visit = (next: string, at = machine) => {
    setTyped(null);
    setFile(null);
    setMachine(at);
    setPath(next);
  };
  useLayoutEffect(() => {
    if (file && list.current?.getClientRects().length === 0) title.current?.focus();
    if (!file && returnTo.current) {
      const key = returnTo.current;
      returnTo.current = null;
      if (key.isConnected) key.focus();
    }
  }, [file]);

  const entries = useMemo(() => {
    const byName = new Intl.Collator(undefined, { numeric: true });
    return folders.data?.entries.slice().sort((a, b) => Number(b.type === "dir") - Number(a.type === "dir") || byName.compare(a.name, b.name));
  }, [folders.data]);
  const error = folders.error instanceof ApiError && folders.error.status === 403 ? t("channel.forbidden") : t("msg.unreadable");
  const url = file ? api.browseFileURL(join(dir, file.name), machine) : "";
  const kind = file ? previewKind(file.name) ?? "text" : "text";
  const image = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i.test(file?.name ?? "");

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-3 pointer-coarse:h-13">
        {file && <IconKey label={t("browse.toFolder")} className="@min-[620px]:hidden" onClick={() => setFile(null)}><ArrowLeft size={17} /></IconKey>}
        <Dialog.Title className="min-w-0 flex-1 text-sm font-semibold">{t("browse.title")}</Dialog.Title>
        <select
          aria-label={t("device.computer")}
          value={machine}
          onChange={(e) => {
            const id = e.currentTarget.value;
            visit(startAt(machines.find((m) => m.id === id)), id);
          }}
          className="h-8 max-w-[60%] rounded-md bg-fill px-2 text-sm text-ink pointer-coarse:h-10"
        >
          <option value="">{t("term.local")}</option>
          {machine && !machines.some((m) => m.id === machine) && <option value={machine}>{machine}</option>}
          {machines.map((m) => <option key={m.id} value={m.id} disabled={!m.online}>{m.online ? m.name : t("new.offline", { name: m.name })}</option>)}
        </select>
      </header>
      <div className={cn("shrink-0 items-center gap-1 border-b border-edge px-2 py-1", file ? "hidden @min-[620px]:flex" : "flex")}>
        <IconKey label={t("browse.up")} aria-disabled={!up} className="aria-disabled:opacity-40 aria-disabled:hover:bg-transparent" onClick={() => up && visit(up)}><ArrowUp size={16} /></IconKey>
        <IconKey label={t(start === "~" ? "pick.home" : "browse.start")} onClick={() => visit(start)}><House size={15} /></IconKey>
        <form className="min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); visit(typed || dir); }}>
          <input aria-label={t("pick.path")} value={typed ?? dir} onChange={(e) => setTyped(e.currentTarget.value)} onBlur={() => setTyped(null)} spellCheck={false} autoComplete="off" className="h-8 w-full rounded-md bg-fill px-2 font-mono text-xs text-ink pointer-coarse:h-10" />
        </form>
        <IconKey label={t("top.reload")} onClick={() => void folders.refetch()}><RefreshCw size={15} /></IconKey>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={list} tabIndex={-1} className={cn("min-w-0 flex-1 flex-col @min-[620px]:flex @min-[620px]:w-72 @min-[620px]:flex-none @min-[620px]:border-r @min-[620px]:border-edge", file ? "hidden" : "flex")}>
          <div key={dir} className="min-h-0 flex-1 overflow-auto overscroll-contain p-1.5">
            {folders.isPending ? <Loading /> : folders.isError ? (
              <p role="status" className="mx-2.5 my-3 text-sm text-ink-2">{error}</p>
            ) : !entries?.length ? (
              <p className="mx-2.5 my-3 text-sm text-ink-3">{t("browse.empty")}</p>
            ) : (
              <ul role="list" className="m-0 list-none p-0">
                {entries.map((entry) => {
                  const directory = entry.type === "dir";
                  const Icon = directory ? Folder : entry.type === "link" ? Link2 : FileText;
                  const content = <><Icon size={16} aria-hidden className="shrink-0 text-ink-3" /><span className="no-bar min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{entry.name}</span></>;
                  const target = join(dir, entry.name);
                  const warm = () => directory ? void prefetchDirectory(machine, target) : void preview().catch(() => {});
                  return (
                    <li key={entry.name}>
                      {directory || entry.type === "file" ? (
                        <button type="button" aria-current={file?.name === entry.name || undefined} className={cn(row, "hover:bg-fill aria-[current=true]:bg-fill aria-[current=true]:font-medium")} onPointerEnter={warm} onPointerDown={warm} onFocus={warm} onClick={(e) => {
                          if (directory) {
                            // Keep keyboard focus in the list as the folder's row is replaced.
                            if (e.detail === 0) list.current?.focus({ preventScroll: true });
                            visit(target);
                          } else {
                            returnTo.current = e.currentTarget;
                            setFile(entry);
                          }
                        }}>{content}</button>
                      ) : <span className={cn(row, "text-ink-3")}>{content}{entry.type === "link" && <span className="text-xs">{t("browse.link")}</span>}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <div className={cn("min-w-0 flex-1 flex-col @min-[620px]:flex", file ? "flex" : "hidden")}>
          {file ? (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-1">
                <h2 ref={title} tabIndex={-1} className="no-bar m-0 min-w-0 flex-1 overflow-x-auto text-sm font-medium whitespace-nowrap outline-none">{file.name}</h2>
                <span className="shrink-0 text-xs text-ink-3 tabular-nums">{size(file.size)}</span>
                <Tip label={t("msg.download")}><a className={action} aria-label={t("msg.download")} download={file.name} href={api.browseFileURL(join(dir, file.name), machine, true)}><Download size={16} /></a></Tip>
              </div>
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain" key={url}>
                {image ? <Image url={url} name={file.name} /> : kind === "pdf" ? (
                  <div className="grid h-full place-items-center">
                    <a href={url} target="_blank" rel="noreferrer" className="g-press inline-flex items-center gap-2 rounded-md bg-fill px-3 py-2 text-sm hover:bg-fill-2"><ExternalLink size={15} />{t("msg.openTab")}</a>
                  </div>
                ) : <Suspense fallback={<Loading />}><PreviewBody url={url} name={file.name} kind={kind} /></Suspense>}
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-sm text-ink-3">{t("browse.noSelection")}</div>
          )}
        </div>
      </div>
    </>
  );
}

function Image({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p role="status" className="px-4 text-sm text-ink-3">{t("msg.noPreview")}</p>;
  return <img src={url} alt={name} onError={() => setFailed(true)} className="mx-auto block max-h-full max-w-full object-contain p-3" />;
}
