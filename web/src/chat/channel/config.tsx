// 群聊配置 (docs/channels.md; the user, 2026-11-12), laid out as the "+" is (pick.tsx): the kinds,
// a press one more agent of it in the channel at once (its nick the next free one); the agents in
// their strip, a face each, its menu its nick, what it receives (@我 or 全部), 移出 (never the
// session the channel is) and the composer's model menu for its session; the apps' logins as
// chips. One who is not of its people sees it all and changes nothing.
import { useState } from "react";
import { api } from "../../api/client";
import type { SessionState } from "../../api/types.gen";
import { useCarried } from "../../store";
import { t, useLang } from "../../i18n";
import { errText, toast } from "../../toast";
import { AGENTS, Tip } from "../../ui";
import { ModelList, modelView } from "../meters";
import { memberError, type Ctl, type Line } from "./key";
import { validNick } from "./lib";
import { freeNick, Kinds, Member, PeopleChips, Strip } from "./pick";

export function Config({ ctl }: { ctl: Ctl }) {
  useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** One change: its failure said under it all. */
  const run = async (f: () => Promise<void> | void): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await f();
      return true;
    } catch (e) {
      setError(memberError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const off = busy || ctl.readOnly;
  return (
    <div className="no-bar flex min-h-0 flex-col gap-2 overflow-y-auto p-2">
      {!ctl.readOnly && <Kinds kinds={ctl.kinds ?? AGENTS} off={off || ctl.lines.length >= 8} add={(a) => void run(() => ctl.add({ agent: a, recv: "at", nick: freeNick(a, ctl.lines.map((l) => l.nick)) }))} />}
      <Strip empty={!ctl.lines.length}>
        {ctl.lines.map((l) => (
          <ChatMember key={l.key} l={l} ctl={ctl} off={off} run={run} />
        ))}
      </Strip>
      <PeopleChips people={ctl.people} me={ctl.me} off={off} set={(p) => void run(() => ctl.setPeople(p))} />
      {ctl.readOnly && ctl.lines.length > 0 && <p className="m-0 px-1 text-xs text-ink-3">{t("channel.notJoined")}</p>}
      {error && <p className="m-0 px-1 text-xs text-err">{error}</p>}
    </div>
  );
}

/** A member's face: its nick kept as the menu shuts (one not allowed is not). */
function ChatMember({ l, ctl, off, run }: { l: Line; ctl: Ctl; off: boolean; run: (f: () => Promise<void> | void) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [nick, setNick] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  // One with no nick yet (a chat's own agent before any joined): the one it would get.
  const typed = nick ?? (l.nick || freeNick(l.agent, ctl.lines.filter((x) => x.key !== l.key).map((x) => x.nick)));
  const taken = (n: string) => ctl.lines.some((x) => x.key !== l.key && x.nick.toLowerCase() === n.toLowerCase());
  const all = l.recv === "all";
  const sid = l.key.startsWith("agent:") ? l.key.slice(6) : "";
  return (
    <Member
      agent={l.agent}
      nick={typed}
      readOnly={off}
      open={open}
      setOpen={(o) => {
        if (!o) {
          if (nick !== null && nick !== l.nick && validNick(nick) && !taken(nick)) void run(() => ctl.patch(l, { nick }));
          setNick(null);
          setSure(false);
        }
        setOpen(o);
      }}
      taken={taken}
      setNick={setNick}
      remove={ctl.readOnly || l.own ? undefined : () => (ctl.confirm && !sure ? setSure(true) : void run(() => ctl.remove(l)).then((ok) => ok && setOpen(false)))}
      aside={
        <>
          {sure && <span className="shrink-0 text-xs text-err">{t("channel.remove")}?</span>}
          <Tip label={t("channel.recv")}>
            <button type="button" disabled={off} aria-label={`${t("channel.recv")}: ${t(all ? "channel.recvAll" : "channel.recvAt")}`} onClick={() => void run(() => ctl.patch(l, { recv: all ? "at" : "all" }))} className="g-press h-6 shrink-0 rounded-full bg-fill px-2 text-xs text-ink-2 enabled:hover:bg-fill-2 enabled:hover:text-ink disabled:opacity-60">
              {t(all ? "channel.recvAll" : "channel.recvAt")}
            </button>
          </Tip>
        </>
      }
    >
      {sid && !ctl.readOnly && <SessionModels id={sid} />}
    </Member>
  );
}

/** A member's session's model menu, as the composer's: each pick sent to it. */
function SessionModels({ id }: { id: string }) {
  const s = useCarried<SessionState>(`session:${id}`);
  if (!s) return null;
  const v = modelView(s);
  if (!v.models.length) return null;
  const fail = (key: "err.model" | "err.effort") => (e: unknown) => (toast(t(key), { error: true, description: errText(e) }), false);
  return <ModelList models={v.models} value={v.value} pickModel={(x) => void api.model(id, x).catch(fail("err.model"))} levels={v.levels} level={v.level} setEffort={(e) => api.effort(id, e).then(() => true, fail("err.effort"))} />;
}
