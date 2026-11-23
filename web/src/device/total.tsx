// The whole this device keeps (device/page.tsx), on the settings' row that opens the 缓存 page: apart
// from the page, which uses the settings' rows (settings.tsx), the two not in each other's chunk.
import { bytes, useDevice } from "./state";

/** The whole kept, for the row that opens the page. */
export function CacheTotal() {
  const d = useDevice();
  if (!d) return null;
  const total = d.usage.image.bytes + d.usage.face.bytes + d.usage.chat.bytes;
  return <span className="g-fade text-xs text-ink-3 tabular-nums">{bytes(total)}</span>;
}
