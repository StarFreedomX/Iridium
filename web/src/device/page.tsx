// The 缓存 page (docs/plan.md "本机缓存"): what this device keeps of this Iridium, by kind (图片,
// 头像, 会话: how many, how much, each let go on its own), how long a thing unused is kept, how
// much at most, and whether the chats are kept at all. Its numbers are read ahead (state.ts).
import { Trash2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { t } from "../i18n";
import { Pills } from "../pills";
import { cn, SureKey, Switch } from "../ui";
import { ahead, bytes, changeConf, clearCat, useDevice } from "./state";
import { DEFAULTS, type Cat } from "./store";

const DAYS = [1, 3, 7, 14, 30];
const CAPS = [100, 200, 500, 1000];
const NAMES: Record<Cat, { label: Parameters<typeof t>[0]; n: Parameters<typeof t>[0] }> = {
  image: { label: "cache.images", n: "cache.nImages" },
  face: { label: "cache.faces", n: "cache.nFaces" },
  chat: { label: "cache.chats", n: "cache.nChats" },
};

/** The whole kept, for the row that opens the page. */
export function CacheTotal() {
  const d = useDevice();
  if (!d) return null;
  const total = d.usage.image.bytes + d.usage.face.bytes + d.usage.chat.bytes;
  return <span className="g-fade text-xs text-ink-3 tabular-nums">{bytes(total)}</span>;
}

export function CachePage({ Item }: { Item: (p: { label: ReactNode; children: ReactNode; below?: boolean }) => ReactNode }) {
  const d = useDevice();
  // Read ahead as its row was pressed; again now, for what came in the meantime.
  useEffect(ahead, []);
  const conf = d?.conf ?? DEFAULTS;
  const kind = (cat: Cat) => {
    const u = d?.usage[cat] ?? { n: 0, bytes: 0 };
    const label = t(NAMES[cat].label);
    return (
      <Item key={cat} label={label}>
        <span className="flex items-center gap-2">
          <span className="text-xs text-ink-3 tabular-nums">
            {t(NAMES[cat].n, { n: u.n })}
            {"  "}
            {bytes(u.bytes)}
          </span>
          <SureKey label={t("cache.clear", { what: label })} sure={t("cache.clearSure")} run={() => void clearCat(cat)} className={cn("size-7", !u.n && "invisible")}>
            <Trash2 size={14} />
          </SureKey>
        </span>
      </Item>
    );
  };
  return (
    <>
      {kind("image")}
      {kind("face")}
      {kind("chat")}
      <Item label={t("cache.days")} below>
        <Pills label={t("cache.days")} value={String(conf.days)} onChange={(v) => void changeConf({ ...conf, days: Number(v) })} options={DAYS.map((n) => ({ value: String(n), label: t("usage.days", { n }) }))} />
      </Item>
      <Item label={t("cache.cap")} below>
        <Pills label={t("cache.cap")} value={String(conf.capMB)} onChange={(v) => void changeConf({ ...conf, capMB: Number(v) })} options={CAPS.map((n) => ({ value: String(n), label: n >= 1000 ? `${n / 1000} GB` : `${n} MB` }))} />
      </Item>
      <Item label={t("cache.keepChats")}>
        <Switch label={t("cache.keepChats")} on={conf.chats} onChange={(v) => void changeConf({ ...conf, chats: v })} />
      </Item>
    </>
  );
}
