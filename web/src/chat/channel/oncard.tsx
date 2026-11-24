// 订阅事件 in an agent's card (docs/channels.md "订阅事件"; kumo, 2026-11-24: in the card, a
// sentence each, not a menu of them nor an editor of kinds): what wakes it beside @. Each one a
// sentence, × takes it away; ＋ adds one of four, filling in one thing: who speaks, a word, a
// time, an event. Saved as each is added or taken away; a ring they make is told.
import { Menu } from "@base-ui/react/menu";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Plus, X } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { api } from "../../api/client";
import type { ChannelMembers, Trigger } from "../../api/types.gen";
import { t } from "../../i18n";
import { toast } from "../../toast";
import { cn, IconKey } from "../../ui";
import { useMembers } from "./gate";
import { memberError } from "./key";
import { triggerWords, useRecvName, useRecvOptions } from "./recv";
import { dailyCron, EVENTS, triggerLine } from "./scripts";

const POPUP = "g-unfold glass thick float rounded-lg p-1.5 text-ink outline-none";
const ITEM = "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-base outline-none select-none data-highlighted:bg-fill data-popup-open:bg-fill pointer-coarse:h-11";
const ROW = "flex min-h-7 items-center gap-1 text-sm leading-5";
const INPUT = "no-ring h-7 min-w-0 flex-1 rounded-md bg-fill px-2 text-sm placeholder:text-ink-3";

/** The section, under the card's keys. may: the one looking is of the channel's people (else it
 *  only reads them). */
export function OnSection({ channel, session, may }: { channel: string; session: string; may: boolean }) {
  const qc = useQueryClient();
  const member = `agent:${session}`;
  const on = useMembers(channel)?.members.find((m) => m.member === member)?.on ?? [];
  const name = useRecvName(channel);
  const w = triggerWords();
  const [typing, setTyping] = useState<"words" | "cron" | null>(null);
  const save = (next: Trigger[]) => {
    const was = qc.getQueryData<ChannelMembers>(["members", channel]);
    if (was) qc.setQueryData<ChannelMembers>(["members", channel], { ...was, members: was.members.map((m) => (m.member === member ? { ...m, on: next } : m)) });
    void api.patchMember(channel, member, { on: next }).then(
      (ms) => {
        qc.setQueryData<ChannelMembers>(["members", channel], ms);
        if (ms.warn?.length) toast(t("on.loop"), { description: ms.warn.join("\n") });
      },
      (e) => (was && qc.setQueryData<ChannelMembers>(["members", channel], was), toast(t("err.action"), { error: true, description: memberError(e) })),
    );
  };
  const add = (tr: Trigger) => (setTyping(null), save([...on, tr]));
  return (
    <div className="mt-3 flex flex-col">
      <div className="flex h-7 items-center text-xs font-medium text-ink-3">
        <span className="flex-1">{t("on.title")}</span>
        {may && <AddMenu channel={channel} session={session} add={add} type={setTyping} />}
      </div>
      <div className={cn(ROW, "text-ink-3")}>{t("on.at")}</div>
      {on.map((tr, i) => (
        <div key={i} className={cn(ROW, "group")}>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{triggerLine(tr, name, w)}</span>
          {may && (
            <IconKey label={t("on.remove")} onClick={() => save(on.filter((_, j) => j !== i))} className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100">
              <X size={13} />
            </IconKey>
          )}
        </div>
      ))}
      {typing && <Typed kind={typing} add={add} cancel={() => setTyping(null)} />}
    </div>
  );
}

/** ＋: who speaks (a submenu of the senders), a word, a time, an event (a submenu). */
function AddMenu({ channel, session, add, type }: { channel: string; session: string; add: (tr: Trigger) => void; type: (k: "words" | "cron") => void }) {
  const senders = useRecvOptions(channel, session);
  const sub = (label: string, i: number, items: { key: string; label: string; face?: ReactNode; tr: Trigger }[]) => (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger style={{ "--i": i } as CSSProperties} className={ITEM}>
        <span className="flex-1">{label}</span>
        <ChevronRight size={14} className="text-ink-4" />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner className="z-50" sideOffset={4} collisionPadding={8}>
          <Menu.Popup className={cn(POPUP, "no-bar max-h-[min(420px,var(--available-height))] min-w-44 overflow-y-auto")}>
            <div className="g-stagger flex flex-col">
              {items.map((x, j) => (
                <Menu.Item key={x.key} onClick={() => add(x.tr)} style={{ "--i": j } as CSSProperties} className={ITEM}>
                  {x.face}
                  <span className="min-w-0 flex-1 truncate">{x.label}</span>
                </Menu.Item>
              ))}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={t("on.add")} className="g-press grid size-6 place-items-center rounded-md text-ink-2 hover:bg-fill hover:text-ink data-popup-open:bg-fill pointer-coarse:size-8">
        <Plus size={14} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="z-50" side="bottom" align="end" sideOffset={4} collisionPadding={8}>
          <Menu.Popup className={cn(POPUP, "min-w-44")}>
            <div className="g-stagger flex flex-col">
              {sub(t("on.addSaid"), 0, senders.map((o) => ({ key: o.entry, label: o.label, face: o.face, tr: { message: { from: [o.entry] } } })))}
              <Menu.Item onClick={() => requestAnimationFrame(() => type("words"))} style={{ "--i": 1 } as CSSProperties} className={ITEM}>
                {t("on.addWords")}
              </Menu.Item>
              <Menu.Item onClick={() => requestAnimationFrame(() => type("cron"))} style={{ "--i": 2 } as CSSProperties} className={ITEM}>
                {t("on.addCron")}
              </Menu.Item>
              {sub(t("on.addEvent"), 3, EVENTS.map((e) => ({ key: e, label: t(`on.ev.${e}`), tr: { event: [e] } })))}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The one thing a word or a time needs, typed in its own row: Enter or ✓ adds it, Esc leaves. */
function Typed({ kind, add, cancel }: { kind: "words" | "cron"; add: (tr: Trigger) => void; cancel: () => void }) {
  const [v, setV] = useState(kind === "cron" ? "09:00" : "");
  const tr: Trigger | undefined = kind === "words" ? (v.trim() ? { message: { from: ["*"], words: [v.trim()] } } : undefined) : (cron => (cron ? { cron } : undefined))(dailyCron(v));
  const done = () => tr && add(tr);
  return (
    <div className={cn(ROW, "g-fade gap-1.5 pt-1")}>
      <input
        autoFocus
        type={kind === "cron" ? "time" : "text"}
        value={v}
        placeholder={kind === "words" ? t("on.wordsPh") : undefined}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => (e.key === "Enter" ? done() : e.key === "Escape" ? (e.stopPropagation(), cancel()) : undefined)}
        className={INPUT}
      />
      <IconKey label={t("on.add")} disabled={!tr} onClick={done} className="size-7">
        <Check size={14} />
      </IconKey>
      <IconKey label={t("on.cancel")} onClick={cancel} className="size-7">
        <X size={14} />
      </IconKey>
    </div>
  );
}
