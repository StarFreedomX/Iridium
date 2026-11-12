// An agent called by its nick among the words of a channel of several (docs/channels.md): drawn
// as a session named is (mention.tsx NamedLink), its harness's logo and its nick, underlined;
// pressed, the composer calls it too. One form, in a person's words and in an agent's Markdown
// (chat/markdown.tsx, by the link lib.ts linkNicks makes of it).
import { createContext, useContext } from "react";
import { Logo, sessionStatusText, Tip } from "../../ui";
import { Worded } from "../mention";
import { nickParts, type AgentRow } from "./lib";

/** The channel's agents, and what a press on one's nick does: for the words drawn under it. */
export const Nicks = createContext<{ agents: AgentRow[]; call: (nick: string) => void } | null>(null);

export function NickLink({ nick }: { nick: string }) {
  const ch = useContext(Nicks);
  const a = ch?.agents.find((x) => x.nick.toLowerCase() === nick.toLowerCase());
  if (!ch || !a) return <>@{nick}</>;
  return (
    <Tip label={[a.name, a.status !== "idle" && sessionStatusText(a)].filter(Boolean).join(" · ")}>
      <button type="button" onClick={() => ch.call(a.nick)} className="inline-flex max-w-full items-baseline gap-1 rounded-sm align-baseline text-ink underline decoration-ink-4 underline-offset-2 hover:decoration-ink-2">
        <span className="self-center">
          <Logo agent={a.agent} size={14} />
        </span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{a.nick}</span>
      </button>
    </Tip>
  );
}

/** A person's words in a channel: what they name drawn in place (Worded), the nicks they call too. */
export function NickWords({ text }: { text: string }) {
  const ch = useContext(Nicks);
  const parts = nickParts(text, ch?.agents.map((a) => a.nick) ?? []);
  return <>{parts.map((p, i) => (typeof p === "string" ? <Worded key={i} text={p} /> : <NickLink key={i} nick={p.nick} />))}</>;
}
