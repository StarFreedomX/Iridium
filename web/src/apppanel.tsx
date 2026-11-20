// The desktop app's panel (appkey.tsx): what the app tells (irapp.ts), and what it is asked.
// Anything that gives this Iridium more of the computer the app asks of the person itself.
import { Check, FolderPlus, Plus, X } from "lucide-react";
import { useState } from "react";
import { t } from "./i18n";
import { ask, type AppState } from "./irapp";
import { Group, Item } from "./settings";
import { cn, IconKey, Switch } from "./ui";

export default function AppPanel({ app }: { app: AppState }) {
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const me = app.computer;
  const set = (terms: object) => ask("set", JSON.stringify(terms));
  return (
    <div className="flex max-h-[min(560px,calc(100dvh-80px))] flex-col gap-4 overflow-y-auto p-3">
      <Group
        title={t("app.servers")}
        action={
          <IconKey
            label={t("app.add")}
            className="-my-2 size-6"
            onClick={() => setAdding(!adding)}
          >
            <Plus size={14} />
          </IconKey>
        }
      >
        {app.servers.map((s) => (
          <div
            key={s.url}
            className="group flex h-9 items-center gap-2 rounded-md"
          >
            <button
              type="button"
              disabled={s.current}
              onClick={() => ask("switch", s.url)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm",
                !s.current && "hover:bg-fill",
              )}
            >
              <span className="grid w-4 shrink-0 place-items-center text-ink-2">
                {s.current && <Check size={14} strokeWidth={2.5} />}
              </span>
              <span className="min-w-0 flex-1 truncate">{s.host}</span>
              {s.joined && (
                <span className="text-xs text-ink-3">
                  {t("app.joinedShort")}
                </span>
              )}
            </button>
            {!s.current && (
              <IconKey
                label={t("app.remove")}
                className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => ask("remove", s.url)}
              >
                <X size={13} />
              </IconKey>
            )}
          </div>
        ))}
        {adding && (
          <form
            className="g-fade mt-1 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (address.trim()) ask("add", address.trim());
            }}
          >
            <input
              autoFocus
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t("app.addressPh")}
              spellCheck={false}
              className="h-8 min-w-0 flex-1 rounded-md bg-fill px-2.5 text-sm outline-none placeholder:text-ink-3"
            />
            <button
              type="submit"
              className="g-press h-8 shrink-0 rounded-md bg-ink px-3 text-sm text-paper"
            >
              {t("app.connect")}
            </button>
          </form>
        )}
      </Group>

      <Group title={t("app.computer", { name: me.name })}>
        <Item label={t("app.joined")} hint={me.joined ? me.status : undefined}>
          <Switch
            label={t("app.joined")}
            on={me.joined}
            onChange={(v) => set({ joined: v })}
          />
        </Item>
        <Item label={t("app.shell")}>
          <Switch
            label={t("app.shell")}
            disabled={!me.joined}
            on={me.shell}
            onChange={(v) => set({ shell: v })}
          />
        </Item>
        <Item
          label={t("app.folders")}
          hint={me.roots.length ? undefined : t("app.allFolders")}
        >
          <IconKey
            label={t("app.addFolder")}
            disabled={!me.joined}
            onClick={() => ask("pickroot")}
          >
            <FolderPlus size={15} />
          </IconKey>
        </Item>
        {me.roots.map((r) => (
          <div
            key={r}
            className="group flex h-8 items-center gap-2 pl-1 text-sm"
          >
            <span className="min-w-0 flex-1 truncate text-ink-2" title={r}>
              {r}
            </span>
            {me.roots.length > 1 ? (
              <IconKey
                label={t("app.remove")}
                className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => set({ roots: me.roots.filter((x) => x !== r) })}
              >
                <X size={13} />
              </IconKey>
            ) : (
              <button
                type="button"
                onClick={() => set({ all: true })}
                className="shrink-0 rounded-sm px-1 text-xs text-ink-3 hover:text-ink"
              >
                {t("app.allFoldersKey")}
              </button>
            )}
          </div>
        ))}
      </Group>

      <Group title={t("app.title")}>
        <Item label={t("app.autostart")}>
          <Switch
            label={t("app.autostart")}
            on={app.autostart}
            onChange={(v) => ask("autostart", v ? "on" : "off")}
          />
        </Item>
        <Item label={t("app.version", { v: app.version })}>
          {app.update ? (
            <button
              type="button"
              onClick={() => ask("update", "restart")}
              className="g-press h-7 rounded-md bg-ink px-2.5 text-xs text-paper"
            >
              {t("app.restartTo", { v: app.update })}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => ask("update", "check")}
              className="g-press h-7 rounded-md px-2.5 text-xs text-ink-2 hover:bg-fill hover:text-ink"
            >
              {t("app.check")}
            </button>
          )}
        </Item>
      </Group>
      {(app.error || app.notice) && (
        <p className={cn("m-0 text-xs", app.error ? "text-err" : "text-ink-3")}>
          {app.error || app.notice}
        </p>
      )}
    </div>
  );
}
