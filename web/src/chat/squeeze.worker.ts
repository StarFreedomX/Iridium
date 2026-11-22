// squeeze.ts's worker: a picture decoded upright, scaled to fit in halves then the rest (each step
// smoothed, as one big step is not), and encoded by libwebp.
import encode, { init } from "@jsquash/webp/encode";
import plainURL from "@jsquash/webp/codec/enc/webp_enc.wasm?url";
import simdURL from "@jsquash/webp/codec/enc/webp_enc_simd.wasm?url";
import { BIG, fit, QUALITY } from "./squeeze-fit";

export type Ask = { id: number; file: File };
export type Answer = { id: number; webp?: ArrayBuffer; error?: string };

let ready: Promise<unknown> | null = null;

async function shrink(file: File): Promise<ArrayBuffer> {
  ready ??= init({ locateFile: (p: string) => (p.includes("simd") ? simdURL : plainURL) });
  await ready;
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const to = fit(bmp.width, bmp.height);
  let src: ImageBitmap | OffscreenCanvas = bmp;
  let w = bmp.width;
  let h = bmp.height;
  for (;;) {
    const half = w / 2 >= to.w && h / 2 >= to.h;
    const nw = half ? Math.round(w / 2) : to.w;
    const nh = half ? Math.round(h / 2) : to.h;
    if (nw === w && nh === h && src instanceof OffscreenCanvas) break;
    const c = new OffscreenCanvas(nw, nh);
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, nw, nh);
    src = c;
    w = nw;
    h = nh;
    if (!half) break;
  }
  bmp.close();
  const data = (src as OffscreenCanvas).getContext("2d")!.getImageData(0, 0, w, h);
  const opts = { method: 4, use_sharp_yuv: 1 };
  let out = await encode(data, { ...opts, quality: QUALITY.first });
  if (out.byteLength > BIG) out = await encode(data, { ...opts, quality: QUALITY.big });
  return out;
}

self.onmessage = async (e: MessageEvent<Ask>) => {
  const { id, file } = e.data;
  try {
    const webp = await shrink(file);
    (self as unknown as Worker).postMessage({ id, webp } satisfies Answer, [webp]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies Answer);
  }
};
