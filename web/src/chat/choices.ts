// What a new agent of a kind may be started with where it would run (its models, the one it
// runs when given none, its efforts, dsh's presets): for the invite menu (channel/pick.tsx) and
// a session whose agent has not said its models yet (meters.tsx ModelKey). They pop at once
// (kumo, 2026-11-15: not looked up as the menu opens): kept in this browser for the next visit,
// and the server answers with what it kept.
import { type QueryClient } from "@tanstack/react-query";
import { useQuery } from "../api/query";
import type { ReactElement } from "react";
import { api } from "../api/client";
import type { Agent, AgentChoices, Model } from "../api/types.gen";
import { agentName } from "../ui";

export type At = { channel?: string; machine?: string };

// 2: no model called "default" in them (the user, 2026-11-16); what was kept before is not read.
const keyOf = (agent: Agent, at: At) => `ir:choices2:${agent}:${at.machine ?? ""}:${at.channel ?? ""}`;

/** What this browser kept of agent's choices at at, from the last time. */
function stored(agent: Agent, at: At): AgentChoices | undefined {
  try {
    const v = localStorage.getItem(keyOf(agent, at));
    return v ? (JSON.parse(v) as AgentChoices) : undefined;
  } catch {
    return undefined;
  }
}

/** The query of agent's choices at at: answered at once with what was kept here, then fresh. */
export const choicesQ = (agent: Agent, at: At) => ({
  queryKey: ["agent-choices", agent, at.channel ?? "", at.machine ?? ""],
  queryFn: async () => {
    const got = await api.agentChoices(agent, at);
    try {
      if (got.models.length) localStorage.setItem(keyOf(agent, at), JSON.stringify(got));
    } catch {
      // A full or closed store: asked again next time.
    }
    return got;
  },
  initialData: () => stored(agent, at),
  initialDataUpdatedAt: 0,
  staleTime: 60_000,
});

/** Each kind's choices asked for ahead, as the menu that leads to them opens. */
export function prefetchChoices(qc: QueryClient, kinds: Agent[], at: At) {
  for (const k of kinds) void qc.prefetchQuery(choicesQ(k, at));
}

/** What a new agent of a kind is started with when given no model, from its kind's choices: def,
 *  the model it will run (the agent's own default, else the one its kind last ran there; none:
 *  not known till it starts); send, what is sent for it: "" for the agent's own, which stays the
 *  agent's to resolve. No model is called "default" (the user, 2026-11-16). */
export function draftDefault(asked?: AgentChoices): { def?: Model; send: string } {
  const def = asked?.models.find((m) => m.default) ?? (asked?.ran ? asked.models.find((m) => m.value === asked.ran) : undefined);
  return { def, send: def && !def.default ? def.value : "" };
}

/** A kind by its name and the model a new one of it will run ("Claude · Opus 5.5"); the name
 *  alone while that is not known. */
export const draftName = (agent: Agent, asked?: AgentChoices) => {
  const { def } = draftDefault(asked);
  return def ? `${agentName(agent)} · ${def.name}` : agentName(agent);
};

/** A kind's draftName at at, its choices asked for, given to what it draws (one of a list: each
 *  asks for its own). */
export function DraftNamed({ agent, at, children }: { agent: Agent; at: At; children: (name: string) => ReactElement }) {
  return children(draftName(agent, useQuery(choicesQ(agent, at)).data));
}
