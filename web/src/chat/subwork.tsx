// A subagent at work in its parent's chat (kumo, 2026-11-15: subagents are members that only
// read; no rows of theirs in the sidebar): its logo with the subagent badge, its task as its
// name, what it said last, the dots. Pressed, its record. Gone as it is done: the step that
// started it holds what it gave back.
import { Bot } from "lucide-react";
import type { Session } from "../api/types.gen";
import { t, useLang } from "../i18n";
import { openChat } from "../route";
import { Logo } from "../ui";
import { Waiting } from "./live";

export function SubAtWork({ s }: { s: Session }) {
  useLang();
  const name = s.workflow?.name ? `${s.workflow.name}${s.title ? ` · ${s.title}` : ""}` : s.title || t("row.subagent");
  const last = s.last?.role === "assistant" ? s.last.text.split("\n").find((l) => l.trim()) : undefined;
  return (
    <button type="button" onClick={() => openChat(s.id)} className="g-press flex w-full min-w-0 items-start gap-2.5 rounded-md text-left" role="status" aria-label={`${name} · ${t("chat.working")}`}>
      <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-fill">
        <Logo agent={s.agent} size={16} />
        <span role="img" aria-label={t("row.subagent")} className="absolute -right-0.5 -bottom-0.5 grid size-[13px] place-items-center rounded-full bg-paper text-ink-2">
          <Bot size={9} strokeWidth={2.5} />
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex h-4 min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-xs font-medium text-ink-2">{name}</span>
          <span className="shrink-0 text-xs text-ink-4">{t("row.subagent")}</span>
        </span>
        {last && <span className="truncate text-sm text-ink-3">{last}</span>}
        <span className="flex h-7 items-center pointer-coarse:h-9">
          <Waiting on quiet={`${s.id} ${s.updatedAt}`} />
        </span>
      </span>
    </button>
  );
}
