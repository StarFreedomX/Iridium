// The model menu of an agent before it is started (invite.tsx): its kind's models and efforts.
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Agent } from "../../api/types.gen";
import { ModelList, modelView } from "../meters";

/** The model menu for an agent not yet started: its kind's models where it would run (GET
 *  …/choices), else those the page knows; model "" its default. */
export function DraftModels({ agent, at, model, effort, set }: { agent: Agent; at: { channel?: string; machine?: string }; model: string; effort: string; set: (p: { model?: string; effort?: string }) => void }) {
  const asked = useQuery({ queryKey: ["agent-choices", agent, at.channel ?? "", at.machine ?? ""], queryFn: () => api.agentChoices(agent, at), staleTime: 60_000 }).data;
  const v = modelView({ agent, models: asked?.models.length ? asked.models : undefined, efforts: asked?.efforts, pick: model, model, effort });
  if (!v.models.length) return null;
  return <ModelList models={v.models} value={v.value} pickModel={(x) => set({ model: x === "default" ? "" : x })} levels={v.levels} level={v.level} setEffort={async (e) => (set({ effort: e }), true)} />;
}
