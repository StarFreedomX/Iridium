// Why a change of a channel's members was refused, and the line shown in the composer's place to
// one who is not of its people (docs/channels.md).
import { ApiError } from "../../api/client";
import { t, useLang } from "../../i18n";
import { errText } from "../../toast";

/** Why a change of the members was refused, in the page's words. */
export function memberError(e: unknown): string {
  if (e instanceof ApiError) {
    const code = (e.body as { code?: string } | undefined)?.code;
    if (e.status === 409 && code === "full") return t("channel.full");
    if (e.status === 403) return t("channel.forbidden");
    if (e.status === 400 && /nick/i.test(e.message)) return t("channel.nickTaken");
    if (e.status === 422 && code === "bad_on" && /loop/.test(e.message)) return t("on.loopRefused");
  }
  return errText(e);
}

/** Where the composer would be, for one not of the channel's people: 未加入. */
export function NotJoined() {
  useLang();
  return <div className="glass float rest flex h-12 items-center justify-center rounded-[20px] px-4 text-sm text-ink-3">{t("channel.notJoined")}</div>;
}
