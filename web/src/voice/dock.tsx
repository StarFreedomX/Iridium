// The voice's small parts that are on the page before any room is joined: the dock's place (the
// dock itself, key.tsx, comes only once in a room), the entry in a folder group's "+", and the
// count on a group's row of who is in its voice.
import { AudioLines, PhoneOff } from "lucide-react";
import { lazy, Suspense, type ReactNode } from "react";
import { t } from "../i18n";
import { useVoiceRooms } from "../store";
import { Tip } from "../ui";
import { join, leave, useVoice } from "./state";

const Part = lazy(() => import("./key").then((m) => ({ default: m.VoiceDock })));
/** The voice this page is in, where it stands: beside me at the sidebar's foot, or (a phone) in
 *  the chat's bar. Nothing, and nothing loaded, while in no room. */
export function VoiceDock(p: { side?: "top" | "bottom"; className?: string }) {
  if (useVoice().status === "off") return null;
  return (
    <Suspense>
      <Part {...p} />
    </Suspense>
  );
}


/** The group's voice as an item of its row's menu (kumo, 2026-11-16: in the group's right-click
 *  menu, not the new-session popover): 语音 (and how many are in it), or 离开 while you are. */
export function useVoiceItem(guild: number): { icon: ReactNode; label: string; run: () => void } {
  const v = useVoice();
  const there = useVoiceRooms()?.[String(guild)]?.length ?? 0;
  const here = v.room === String(guild) && v.status !== "off";
  if (here) return { icon: <PhoneOff size={15} className="text-err" />, label: t("voice.leave"), run: () => leave() };
  return { icon: <AudioLines size={15} />, label: there > 0 ? `${t("voice.join")} · ${t("voice.count", { n: there })}` : t("voice.join"), run: () => join(String(guild)) };
}

/** On a folder group's row: how many are in its voice, to those not in it too; pressed, into it. */
export function VoiceMark({ guild }: { guild: number }) {
  const v = useVoice();
  const there = useVoiceRooms()?.[String(guild)]?.length ?? 0;
  if (!there) return null;
  const here = v.room === String(guild) && v.status !== "off";
  return (
    <Tip label={t("voice.here", { n: there })} side="bottom">
      <button type="button" disabled={here} aria-label={t("voice.here", { n: there })} onClick={(e) => (e.stopPropagation(), join(String(guild)))} className="g-pop g-press flex h-6 items-center gap-0.5 rounded-sm px-1 text-xs text-run tabular-nums hover:bg-fill-2 disabled:hover:bg-transparent pointer-coarse:h-8">
        <AudioLines size={12} />
        {there}
      </button>
    </Tip>
  );
}
