// The desktop app's panel (appkey.tsx): this computer as joined to each Iridium in the app's list
// (its state; command lines, folders, each agent, switched at once), and the app itself. Turning
// one off is done at once; turning one on the app asks of the person in a dialog of its own.
import { FolderPlus, Plus, Trash2 } from "lucide-react";
import type { Agent } from "./api/types.gen";
import { t } from "./i18n";
import { ask, type AppServer, type AppState } from "./irapp";
import { Group, Item } from "./settings";
import { agentName, cn, IconKey, Logo, SureKey, Switch } from "./ui";

export default function AppPanel({ app }: { app: AppState }) {
  return (
    <div className="flex max-h-[min(620px,calc(100dvh-80px))] flex-col gap-4 overflow-y-auto p-3">
      <Group
        title={t("app.computer", { name: app.name })}
        action={
          // The app's own page: the Iridiums, one added and logged in to from the browser there.
          <IconKey
            label={t("app.add")}
            className="-my-2 size-6"
            onClick={() => ask("home")}
          >
            <Plus size={14} />
          </IconKey>
        }
      >
        <div className="flex flex-col gap-2">
          {app.servers.map((s) => (
            <ServerBox key={s.url} s={s} />
          ))}
          {!app.hasLocal && (
            // This computer's own Iridium, started and shown (internal/desktop/local.go).
            <Item label={t("app.runLocal")}>
              <button
                type="button"
                onClick={() => ask("local")}
                className="g-press h-7 rounded-md px-2.5 text-xs text-ink-2 hover:bg-fill hover:text-ink"
              >
                {t("app.run")}
              </button>
            </Item>
          )}
        </div>
      </Group>

      <Group title={t("app.title")}>
        <Item label={t("app.server")}>
          <Switch
            label={t("app.server")}
            on={app.server !== false}
            onChange={(v) => ask("server", v ? "on" : "off")}
          />
        </Item>
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

/** One Iridium, flat rows as the settings have them (docs/前端设计规范.md "设置", "列表"): its name
 *  (pressed, shown in the window) with this computer's state there and the joining switch; then
 *  command lines, each agent, the folders. Removed by a trash key pressed twice, no ×. */
function ServerBox({ s }: { s: AppServer }) {
  const set = (terms: object) =>
    ask("set", JSON.stringify({ url: s.url, ...terms }));
  return (
    <div className="flex flex-col">
      <div className="flex min-h-10 items-center gap-3 py-1">
        <button
          type="button"
          disabled={s.current}
          onClick={() => ask("switch", s.url)}
          className="flex min-w-0 flex-1 flex-col items-start text-left enabled:hover:text-ink-2"
        >
          <span className="max-w-full truncate text-sm font-medium">
            {s.local ? t("app.local") : s.host}
          </span>
          <span className="max-w-full truncate text-xs text-ink-3">
            {s.current ? `${s.status}  ${t("app.shown")}` : s.status}
          </span>
        </button>
        {!s.current && (
          <SureKey
            label={t("app.remove")}
            sure={t("app.removeSure")}
            run={() => ask("remove", s.url)}
            className="size-7"
          >
            <Trash2 size={14} />
          </SureKey>
        )}
        {!s.local && (
          <Switch
            label={t("app.joined")}
            on={s.joined}
            onChange={(v) => set({ joined: v })}
          />
        )}
      </div>
      <div
        aria-hidden={!s.joined || undefined}
        inert={!s.joined || undefined}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-(--dur-3) ease-(--ease-out)",
          s.joined ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <Item label={t("app.shell")}>
            <Switch
              label={t("app.shell")}
              on={s.shell}
              onChange={(v) => set({ shell: v })}
            />
          </Item>
          {s.agents.map((a) => (
            <Item
              key={a.name}
              label={
                <span className="flex items-center gap-2">
                  <Logo agent={a.name as Agent} size={14} />
                  {agentName(a.name as Agent)}
                </span>
              }
            >
              <Switch
                label={agentName(a.name as Agent)}
                on={a.on}
                onChange={(v) => set({ agents: { [a.name]: v } })}
              />
            </Item>
          ))}
          <Item
            label={t("app.folders")}
            hint={s.roots.length ? undefined : t("app.allFolders")}
          >
            <IconKey
              label={t("app.addFolder")}
              onClick={() => ask("pickroot", s.url)}
            >
              <FolderPlus size={15} />
            </IconKey>
          </Item>
          {s.roots.map((r) => (
            <Item key={r} label={<span className="text-ink-2">{r}</span>}>
              {s.roots.length > 1 ? (
                <SureKey
                  label={t("app.remove")}
                  sure={t("app.removeSure")}
                  run={() => set({ roots: s.roots.filter((x) => x !== r) })}
                  className="size-7"
                >
                  <Trash2 size={14} />
                </SureKey>
              ) : (
                <button
                  type="button"
                  onClick={() => set({ all: true })}
                  className="g-press h-7 rounded-md px-2.5 text-xs text-ink-2 hover:bg-fill hover:text-ink"
                >
                  {t("app.allFoldersKey")}
                </button>
              )}
            </Item>
          ))}
        </div>
      </div>
    </div>
  );
}
