// A face or a background, chosen (docs/next/group.md "改资料"): an image uploaded, one emoji, a
// colour, or none. One row: what it is, what it looks like now, a key for each way; the emoji
// and the colours open under the row, in place (no popover: docs/前端设计规范.md "设置").
// And a line of a card that is typed (Field: what it is called by, its intro).
// Used by 编辑资料 (chat/channel/edit.tsx) and this panel's own profile (profile.tsx).
import { ImagePlus, LoaderCircle, Palette, Smile, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { COLOURS, EMOJI, emojiOf } from "./facevalue";
import { t } from "./i18n";
import { errText, toast } from "./toast";
import { cn, IconKey } from "./ui";

/** A picture made small enough to send (kumo, 2026-11-16: the page shrinks it, never the user):
 *  within fit across and down (a background is kept at 720×270, a face at 128), then as WebP,
 *  lower in quality till it is under SEND (a data: URL in a JSON body the daemon reads up to
 *  1 MiB; base64 a third more). One already small enough goes as it is. */
const SEND = 700 << 10;
export async function shrink(f: Blob, fit = 1440): Promise<Blob> {
  const bmp = await createImageBitmap(f);
  const k = Math.min(1, fit / Math.max(bmp.width, bmp.height));
  if (k === 1 && f.size <= SEND) return (bmp.close(), f);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  for (const q of [0.9, 0.8, 0.65, 0.5, 0.35]) {
    const b = await new Promise<Blob | null>((done) => c.toBlob(done, "image/webp", q));
    if (b && b.size <= SEND) return b;
  }
  throw new Error(t("profile.tooBig"));
}

export const asDataURL = (f: Blob) =>
  new Promise<string>((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(f);
  });

/** label: what it is (头像, 背景); preview: how it looks now; set: the value given, as the
 *  daemon takes it (a data: URL, an emoji, a colour, "" for none), saved at once. upload: a
 *  picture chosen goes there instead (a face: cropped first, as the face itself does). */
export function FacePick({ label, preview, set, disabled, upload, still }: { label: string; preview: ReactNode; set: (v: string) => Promise<unknown>; disabled?: boolean; upload?: (f: File) => void; still?: boolean }) {
  const [open, setOpen] = useState<"emoji" | "colour" | null>(null);
  // What was open stays drawn while it folds away.
  const [shown, setShown] = useState<"emoji" | "colour">("emoji");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const other = useRef<HTMLInputElement>(null);
  const give = async (v: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await set(v);
    } catch (e) {
      toast(t("err.action"), { error: true, description: errText(e) });
    } finally {
      setBusy(false);
    }
  };
  const giveNow = useRef(give);
  giveNow.current = give;
  // The colour chosen in the browser's own picker: given once it is put away, not at each move.
  useEffect(() => {
    const el = other.current;
    if (!el) return;
    const done = () => void giveNow.current(el.value);
    el.addEventListener("change", done);
    return () => el.removeEventListener("change", done);
  }, []);
  const toggle = (k: "emoji" | "colour") => (setShown(k), setOpen(open === k ? null : k));
  const off = disabled || busy;
  return (
    <div className="flex flex-col">
      <div className="flex min-h-10 items-center gap-2 py-1">
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        <span className="relative mr-1 grid shrink-0 place-items-center">
          {preview}
          {busy && (
            <span className="g-fade absolute inset-0 grid place-items-center rounded-[inherit] bg-paper/70">
              <LoaderCircle size={14} className="animate-spin text-ink-2" />
            </span>
          )}
        </span>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (upload) return upload(f);
            void shrink(f)
              .then(asDataURL).then(give, (err) => toast(t("err.action"), { error: true, description: errText(err) }));
          }}
        />
        <span className="flex shrink-0 items-center gap-0.5">
          {/* still: no picture, only an emoji or a colour (a script's face). */}
          {!still && (
            <IconKey label={t("profile.upload")} disabled={off} onClick={() => file.current?.click()} className="size-7">
              <ImagePlus size={15} />
            </IconKey>
          )}
          <IconKey label={t("profile.emoji")} disabled={off} aria-expanded={open === "emoji"} onClick={() => toggle("emoji")} className={cn("size-7", open === "emoji" && "bg-fill text-ink")}>
            <Smile size={15} />
          </IconKey>
          <IconKey label={t("profile.colour")} disabled={off} aria-expanded={open === "colour"} onClick={() => toggle("colour")} className={cn("size-7", open === "colour" && "bg-fill text-ink")}>
            <Palette size={15} />
          </IconKey>
          <IconKey label={t("profile.remove")} disabled={off} onClick={() => void give("")} className="size-7">
            <Trash2 size={15} />
          </IconKey>
        </span>
      </div>
      <div aria-hidden={!open || undefined} inert={!open || undefined} className="g-reveal" data-open={open ? "" : undefined}>
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-end gap-1 pt-0.5 pb-2">
            {shown === "emoji" ? (
              <>
                {EMOJI.map((e) => (
                  <button key={e} type="button" disabled={off} onClick={() => void give(e)} className="g-press grid size-8 place-items-center rounded-md text-[18px] leading-none hover:bg-fill pointer-coarse:size-10">
                    {e}
                  </button>
                ))}
                {/* Any other: typed (the system's emoji keyboard); the one typed last is taken. */}
                <input
                  aria-label={t("profile.emojiType")}
                  placeholder={t("profile.emojiType")}
                  disabled={off}
                  value=""
                  onChange={(e) => {
                    const v = emojiOf(e.target.value);
                    if (v) void give(v);
                  }}
                  className="no-ring h-8 w-32 min-w-0 rounded-md bg-fill px-2.5 text-sm placeholder:text-ink-3 pointer-coarse:h-10"
                />
              </>
            ) : (
              <>
                {COLOURS.map((c) => (
                  <button key={c} type="button" disabled={off} aria-label={c} onClick={() => void give(c)} className="g-press grid size-8 place-items-center rounded-md hover:bg-fill pointer-coarse:size-10">
                    <span className="size-5 rounded-full shadow-[inset_0_0_0_0.5px_var(--edge)]" style={{ background: c }} />
                  </button>
                ))}
                <label className={cn("g-press relative grid size-8 cursor-pointer place-items-center rounded-md text-ink-2 hover:bg-fill hover:text-ink pointer-coarse:size-10", off && "pointer-events-none opacity-40")} aria-label={t("profile.colourOther")}>
                  <span className="size-5 rounded-full shadow-[inset_0_0_0_0.5px_var(--edge)]" style={{ background: "conic-gradient(#e5484d, #f5d90a, #46a758, #0090ff, #8e4ec6, #e5484d)" }} />
                  <input ref={other} type="color" defaultValue="#2f4f6f" disabled={off} className="absolute inset-0 size-full cursor-pointer opacity-0" />
                </label>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A background as a small strip: the image, or the flat ground with none. */
export function BannerThumb({ src }: { src?: string }) {
  const [gone, setGone] = useState<string | null>(null);
  return <span className="relative block h-7 w-12 overflow-hidden rounded-md bg-fill-2">{src && gone !== src && <img src={src} alt="" draggable={false} onError={() => setGone(src)} className="absolute inset-0 size-full object-cover" />}</span>;
}

const INPUT = "no-ring w-full min-w-0 rounded-md bg-fill px-2.5 text-base placeholder:text-ink-3";

/** A line of the card, typed: saved as it is left (Enter leaves it), Esc puts back what it was.
 *  bad: why what is typed cannot be saved ("": it can; blank: it cannot, and nothing is said);
 *  count: how many of max are used; explain: a refusal in the page's words. */
export function Field({ label, value, max, multi, count, bad, save, explain = errText }: { label: string; value: string; max: number; multi?: boolean; count?: boolean; bad?: (v: string) => string; save: (v: string) => Promise<unknown>; explain?: (e: unknown) => string }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const focused = useRef(false);
  // What the daemon has now, unless it is being typed over.
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const why = bad?.(draft).trim() ?? "";
  const leave = async () => {
    focused.current = false;
    if (draft === value || busy) return;
    if (bad?.(draft)) return why ? undefined : setDraft(value);
    setBusy(true);
    try {
      await save(draft);
      setError("");
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };
  const keys = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") (e.preventDefault(), (e.currentTarget as HTMLElement).blur());
    // Its own Esc: the card or the settings it is in stays open.
    if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), setDraft(value), setError(""), requestAnimationFrame(() => (e.target as HTMLElement).blur()));
  };
  const common = {
    "aria-label": label,
    value: draft,
    maxLength: max,
    onFocus: () => void (focused.current = true),
    onBlur: () => void leave(),
    onKeyDown: keys,
  };
  const n = [...draft].length;
  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        {busy && <LoaderCircle size={12} className="animate-spin self-center text-ink-3" />}
        {count && <span className={cn("text-xs tabular-nums", n > max ? "text-err" : "text-ink-3")}>{`${n}/${max}`}</span>}
      </div>
      {multi ? (
        <textarea {...common} rows={2} onChange={(e) => (setDraft(e.target.value.replace(/\n/g, " ")), setError(""))} className={cn(INPUT, "field-sizing-content max-h-40 min-h-[3.25rem] resize-none py-1.5 leading-5")} />
      ) : (
        <input {...common} onChange={(e) => (setDraft(e.target.value), setError(""))} className={cn(INPUT, "h-8 pointer-coarse:h-10")} />
      )}
      {(why || error) && <p className="m-0 px-0.5 text-xs text-err">{why || error}</p>}
    </div>
  );
}
