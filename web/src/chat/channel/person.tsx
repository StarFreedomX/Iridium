// A person's card in a channel (the user, 2026-11-13: people, apps and agents are peers): their
// face pressed opens it, as an agent's does (members.tsx Card). Their face and name; 私聊, the
// channel of the two of you (POST /v1/internal/dm), and 提及, "@name" in the composer.
import { AtSign, MessageCircle } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { t } from "../../i18n";
import { openChat } from "../../route";
import { errText, toast } from "../../toast";
import { Avatar, cn } from "../../ui";

const KEY = "g-press flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-fill px-2 text-sm text-ink hover:bg-fill-2 disabled:opacity-50 pointer-coarse:h-10";

/** user: their Satori user id (a login's, "local" the host's); app: the app they came by. */
export function PersonCard({ user, name, avatar, app, call }: { user: string; name: string; avatar?: string; app?: string; call?: (name: string) => void }) {
  const [busy, setBusy] = useState(false);
  const talk = () => {
    setBusy(true);
    void api.dm(user).then(
      (r) => openChat(r.channel),
      (e) => (setBusy(false), toast(t("err.action"), { error: true, description: errText(e) })),
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Avatar src={avatar} name={name} size={48} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-semibold">{name}</span>
          {app && <span className="truncate text-xs text-ink-3">{app}</span>}
        </div>
      </div>
      <div className="flex gap-1.5">
        <button type="button" disabled={busy} onClick={talk} className={KEY}>
          <MessageCircle size={14} className="shrink-0" />
          <span className="truncate">{t("channel.dm")}</span>
        </button>
        {call && (
          <button type="button" onClick={() => call(name)} className={cn(KEY)}>
            <AtSign size={14} className="shrink-0" />
            <span className="truncate">{t("channel.call")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
