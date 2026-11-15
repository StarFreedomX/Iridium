// The model menu of an agent before it is started (invite.tsx): its kind's models and efforts,
// and dsh's presets. They pop at once (kumo, 2026-11-15: not looked up as the menu opens): asked
// for as the members' menu opens (prefetchChoices), kept in this browser for the next visit, and
// the server answers with what it kept.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { api } from "../../api/client";
import type { Agent, AgentChoices } from "../../api/types.gen";
import { t, useLang } from "../../i18n";
import { ModelList, modelView, presetName } from "../meters";

type At = { channel?: string; machine?: string };

const keyOf = (agent: Agent, at: At) => `ir:choices:${agent}:${at.machine ?? ""}:${at.channel ?? ""}`;

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

/** The model menu for an agent not yet started: its kind's models where it would run, else those
 *  the page knows; model "" its default, marked 默认. Picking one adds it (set). dsh: its presets
 *  at the foot, picked in place. */
export function DraftModels({ agent, at, model, effort, preset, set }: { agent: Agent; at: At; model: string; effort: string; preset?: string; set: (p: { model?: string; effort?: string; preset?: string }) => void }) {
  useLang();
  const asked = useQuery(choicesQ(agent, at)).data;
  const known = asked?.models.length ? asked.models : undefined;
  const v = modelView({ agent, models: known, efforts: asked?.efforts, pick: model, model, effort });
  const def = modelView({ agent, models: known, efforts: asked?.efforts, pick: "", model: "", effort }).value;
  if (!v.models.length) return null;
  const presets = asked?.presets?.presets ?? [];
  const now = preset || asked?.presets?.default || presets[0]?.id || "";
  // Under the models, its own block (ModelList's foot is the effort's).
  const foot =
    presets.length > 1 ? (
      <div className="mt-1 flex shrink-0 flex-col border-t border-(--edge) pt-1">
        <div className="truncate px-2.5 pb-0.5 text-xs text-ink-3 select-none">{t("composer.preset")}</div>
        {presets.map((p) => (
          <button key={p.id} type="button" onClick={() => set({ preset: p.id === asked?.presets?.default ? "" : p.id })} className="flex h-8 w-full cursor-default items-center gap-2.5 rounded-md px-2.5 text-left text-base outline-none select-none hover:bg-fill focus-visible:bg-fill pointer-coarse:h-11">
            <span className="min-w-0 flex-1 truncate">{presetName(p.id, p)}</span>
            {p.id === now && <Check size={14} className="text-ink" />}
          </button>
        ))}
      </div>
    ) : undefined;
  return (
    <>
      <ModelList models={v.models} value={v.value} mark={{ value: def, label: t("model.default") }} pickModel={(x) => set({ model: x === "default" ? "" : x })} levels={v.levels} level={v.level} setEffort={async (e) => (set({ effort: e }), true)} />
      {foot}
    </>
  );
}
