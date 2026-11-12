// A new session's members, chosen before it is made (docs/channels.md; the user, 2026-11-12):
// under the agents of the "+" (create.tsx NewSession), 群聊配置's key, editing a draft; once it
// was opened, the agent picked above is the draft's first, and a line under it takes the first
// message: sent, the session is made with them all (NewSession.members) and the message said
// once every agent is there. Nothing is sent before.
import { ArrowUp, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { Agent, ChannelSetup } from "../../api/types.gen";
import { useMe } from "../../data";
import { t, useLang } from "../../i18n";
import { agentName, fine, Tip } from "../../ui";
import { MembersKey, type Ctl, type Line } from "./key";
import { appAll, draftNicks, EVERYONE, loginOf, setupOf, type Draft } from "./setup";

/** What the session is made with beside its agent and folder. */
export type Extra = { text?: string; members?: ChannelSetup };

/** first: the agent picked above. kinds: those the folder's machine offers. armed: the popup was
 *  opened (arm says so): the message's line shows, and start makes the session. */
export default function DraftFoot({ first, kinds, armed, arm, busy, start }: { first: Agent; kinds: Agent[]; armed: boolean; arm: () => void; busy: boolean; start: (x: Extra) => void }) {
  useLang();
  const me = useMe().data;
  const [d, setD] = useState<Omit<Draft, "first"> & { nick: string; recv: string }>({ more: [], people: [EVERYONE], nick: "", recv: "all" });
  const [text, setText] = useState("");
  const draft: Draft = { first: { agent: first, nick: d.nick, recv: d.recv }, more: d.more, people: d.people };
  const nicks = draftNicks(draft);
  const lines: Line[] = [
    { key: "first", agent: first, nick: d.nick, name: agentName(first), recv: d.recv, own: true },
    ...d.more.map((m, i) => ({ key: `more${i}`, agent: m.agent, nick: m.nick ?? "", name: [agentName(m.agent), m.model, m.effort].filter(Boolean).join(" "), recv: m.recv ?? "at", own: false })),
  ];
  const at = (l: Line) => Number(l.key.slice(4));
  const ctl: Ctl = {
    lines,
    people: d.people,
    me: me?.host ? appAll(me.app) : me?.login ? loginOf(me.app, me.login) : undefined,
    readOnly: false,
    confirm: false,
    kinds,
    hint: (l) => nicks[lines.findIndex((x) => x.key === l.key)] ?? "",
    options: () => ({ models: [], levels: [] }),
    add: (m) => setD((x) => ({ ...x, more: [...x.more, m] })),
    remove: (l) => setD((x) => ({ ...x, more: x.more.filter((_, i) => i !== at(l)) })),
    patch: (l, p) => setD((x) => (l.own ? { ...x, ...(p.nick !== undefined ? { nick: p.nick } : {}), ...(p.recv ? { recv: p.recv } : {}) } : { ...x, more: x.more.map((m, i) => (i === at(l) ? { ...m, ...p } : m)) })),
    setPeople: (p) => setD((x) => ({ ...x, people: p })),
  };
  const go = () => !busy && start({ ...(text.trim() ? { text: text.trim() } : {}), ...(setupOf(draft) ? { members: setupOf(draft) } : {}) });
  return (
    <div className="flex flex-col gap-1">
      {armed && (
        <div className="g-fade flex items-end gap-1 rounded-md bg-fill py-1 pr-1 pl-2.5">
          <textarea
            autoFocus
            rows={2}
            value={text}
            aria-label={t("channel.first")}
            placeholder={t("channel.first")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey && (fine() || e.ctrlKey || e.metaKey)) (e.preventDefault(), go());
            }}
            className="no-ring max-h-32 min-h-[44px] min-w-0 flex-1 resize-none bg-transparent py-1 text-base placeholder:text-ink-3"
          />
          <Tip label={t("composer.send")}>
            <button type="button" aria-label={t("composer.send")} disabled={busy} onClick={go} className="g-press grid size-7 shrink-0 place-items-center rounded-[9px] bg-ink text-on-ink disabled:opacity-50 pointer-coarse:size-8">
              {busy ? <LoaderCircle size={14} className="animate-spin" /> : <ArrowUp size={16} strokeWidth={2.25} />}
            </button>
          </Tip>
        </div>
      )}
      <div className="flex">
        <MembersKey ctl={ctl} onOpenChange={(o) => o && arm()} />
      </div>
    </div>
  );
}
