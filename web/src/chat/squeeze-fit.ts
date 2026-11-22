// What squeeze.ts sends smaller and how, apart from the worker it starts (the worker reads it too).

/** The most pixels a picture keeps (Claude scales past about 1.15M itself), its shorter side at
 *  most SHORT (a photo, a screen), its longer at most WebP's own limit. */
export const FIT = { pixels: 6_000_000, short: 1440, long: 16383 };
/** libwebp's quality, and a lower one for a picture still over BIG. sharp_yuv keeps coloured
 *  small type (code, an error in red) sharp. */
export const QUALITY = { first: 78, big: 66 };
export const BIG = 1 << 20;
/** Smaller than this, a picture goes as it is; a result not under KEEP of the original too. */
export const SMALL = 100 << 10;
export const KEEP = 0.8;

const STILL = new Set(["image/png", "image/jpeg", "image/webp", "image/bmp"]);

/** Whether f is a picture that may be sent smaller (still or not: see moving). */
export const squeezable = (f: File) => STILL.has(f.type) && f.size >= SMALL;

/** The size w×h is drawn at: within FIT, never larger. */
export function fit(w: number, h: number): { w: number; h: number } {
  const s = Math.min(1, Math.sqrt(FIT.pixels / (w * h)), FIT.short / Math.min(w, h), FIT.long / Math.max(w, h));
  return { w: Math.max(1, Math.floor(w * s + 1e-6)), h: Math.max(1, Math.floor(h * s + 1e-6)) };
}

/** name with a .webp end in place of its own. */
export const asWebp = (name: string) => `${name.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "image"}.webp`;

/** Whether the bytes (a file's start) are a moving PNG (an acTL chunk before its first IDAT) or a
 *  moving WebP (VP8X with the animation flag). */
export function moving(b: Uint8Array): boolean {
  const s = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
  if (b.length >= 21 && s(0, 4) === "RIFF" && s(8, 4) === "WEBP" && s(12, 4) === "VP8X") return (b[20]! & 0x02) !== 0;
  if (b.length < 8 || b[0] !== 0x89 || s(1, 3) !== "PNG") return false;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let at = 8; at + 8 <= b.length; ) {
    const type = s(at + 4, 4);
    if (type === "acTL") return true;
    if (type === "IDAT") return false;
    at += 12 + v.getUint32(at);
  }
  return false;
}

