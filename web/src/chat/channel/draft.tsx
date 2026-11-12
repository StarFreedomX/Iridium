// A new session as the "+" makes it (create.tsx NewSession; the user, 2026-11-12), on one page:
// the kinds in a row, each press one more agent of it into the strip under them (its nick
// prefilled, its menu out: the composer's model menu); the apps' logins as chips; 完成 makes it.
// The first agent in the strip is the session, those after it join it (NewSession.members). No
// first message.
import { useState } from "react";
import type { Agent, NewSession } from "../../api/types.gen";
import { MainKey } from "../../card";
import { useMe } from "../../data";
import { t, useLang } from "../../i18n";
import type { Machine } from "../../machines";
import { DraftModels, freeNick, Kinds, Member, PeopleChips, Strip } from "./pick";
import { validNick } from "./lib";
import { appAll, EVERYONE, loginOf, setupOf } from "./setup";

/** What the session is made with beside its agent and folder. */
export type Extra = Pick<NewSession, "model" | "effort" | "members">;

/** An agent chosen: what it starts with, "" its default. */
type Chosen = { key: number; agent: Agent; model: string; effort: string; nick: string };

let keys = 0;

/** agents: the kinds shown (missing: one not installed, faded); m: the folder's machine, when it is
 *  another's. busy: a session being made. start: 完成, with the first agent chosen. */
export default function NewChannel({ agents, missing, m, busy, start }: { agents: Agent[]; missing: (a: Agent) => boolean; m?: Machine; busy: boolean; start: (first: Agent, x: Extra) => void }) {
  useLang();
  const me = useMe().data;
  const mine = me?.host ? appAll(me.app) : me?.login ? loginOf(me.app, me.login) : undefined;
  const [picks, setPicks] = useState<Chosen[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [people, setPeople] = useState<string[]>([EVERYONE]);
  const patch = (k: number, p: Partial<Chosen>) => setPicks((x) => x.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const taken = (k: number, n: string) => picks.some((l) => l.key !== k && l.nick.toLowerCase() === n.toLowerCase());
  const add = (a: Agent) => {
    const key = ++keys;
    setPicks((x) => [...x, { key, agent: a, model: "", effort: "", nick: freeNick(a, x.map((l) => l.nick)) }]);
    setOpen(key);
  };
  const done = () => {
    const [first, ...more] = picks;
    if (!first || busy) return;
    const members = setupOf({ first: { agent: first.agent, nick: first.nick, recv: "all" }, more: more.map((l) => ({ agent: l.agent, recv: "at", nick: l.nick, ...(l.model ? { model: l.model } : {}), ...(l.effort ? { effort: l.effort } : {}) })), people });
    start(first.agent, { ...(first.model ? { model: first.model } : {}), ...(first.effort ? { effort: first.effort } : {}), ...(members ? { members } : {}) });
  };
  return (
    <div className="flex flex-col gap-2">
      <Kinds kinds={agents} missing={missing} m={m} off={busy || picks.length >= 8} add={add} />
      <Strip empty={!picks.length}>
        {picks.map((l) => (
          <Member
            key={l.key}
            agent={l.agent}
            nick={l.nick}
            open={open === l.key}
            setOpen={(o) => {
              // Shut with a nick not allowed: the one it would get.
              if (!o && (!validNick(l.nick) || taken(l.key, l.nick))) patch(l.key, { nick: freeNick(l.agent, picks.filter((x) => x.key !== l.key).map((x) => x.nick)) });
              setOpen(o ? l.key : null);
            }}
            taken={(n) => taken(l.key, n)}
            setNick={(nick) => patch(l.key, { nick })}
            remove={() => (setOpen(null), setPicks((x) => x.filter((y) => y.key !== l.key)))}
          >
            <DraftModels agent={l.agent} at={{ machine: m?.id ?? "" }} model={l.model} effort={l.effort} set={(p) => patch(l.key, p)} />
          </Member>
        ))}
      </Strip>
      <PeopleChips people={people} me={mine} set={setPeople} />
      <div className="flex justify-end">
        <MainKey busy={busy} disabled={!picks.length} onClick={done}>
          {t("me.done")}
        </MainKey>
      </div>
    </div>
  );
}
