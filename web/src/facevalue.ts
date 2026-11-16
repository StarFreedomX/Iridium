// What a face or a background may be given as (docs/next/group.md "改资料"; internal/server
// profile.go faceValue): an image (a data: URL), one emoji, a colour ("#2f4f6f"), or "" for none.
// Pure, for tests: what a typed value is, as the server reads it.

/** A colour as the server takes it: #rgb or #rrggbb. */
export const isColour = (v: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

/** The characters of v as a reader counts them (an emoji of several code points is one). */
function graphemes(v: string): string[] {
  const S = (Intl as { Segmenter?: new (l?: string, o?: { granularity: "grapheme" }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  return S ? [...new S(undefined, { granularity: "grapheme" }).segment(v)].map((x) => x.segment) : [...v];
}

/** Whether v is one emoji: one character as read, of no letter, digit or space of ASCII, and
 *  no longer than the server takes (8 code points). */
export function isEmoji(v: string): boolean {
  if (!v || [...v].length > 8 || graphemes(v).length !== 1) return false;
  // Pictographic, or a flag's pair, or a keycap's base and mark.
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(v) && ![...v].some((c) => c.codePointAt(0)! < 0x80);
}

/** The one emoji typed into a field: the last character of it, if that is one; else "". */
export function emojiOf(typed: string): string {
  const last = graphemes(typed.trim()).at(-1) ?? "";
  return isEmoji(last) ? last : "";
}

export type FaceKind = "none" | "image" | "emoji" | "colour";

/** What a value given for a face or a background is; undefined: none the server takes. */
export function faceKind(v: string): FaceKind | undefined {
  const x = v.trim();
  if (!x) return "none";
  if (/^data:image\/(png|jpeg|webp);base64,/.test(x)) return "image";
  if (isColour(x)) return "colour";
  return isEmoji(x) ? "emoji" : undefined;
}

/** The most an image given may weigh (internal/gate MaxAvatarBytes). */
export const MAX_IMAGE = 2 << 20;

/** The colours and the emoji offered to pick from; any other is typed or chosen. */
export const COLOURS = ["#2f4f6f", "#3d6b5c", "#7a5c3e", "#8a4b5a", "#5b4f8a", "#c9772e", "#4a4a4a", "#d8dee6"];
export const EMOJI = ["🙂", "🤖", "🧪", "🛠️", "📚", "🔍", "✍️", "🎨", "🧭", "🌱", "🔥", "🌙", "🐱", "🦊", "🐙", "🍀"];
