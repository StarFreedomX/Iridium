// Pictures sent smaller (src/chat/squeeze-fit.ts): the size drawn at, the name, what goes as it is.
import { expect, test } from "vitest";
import { asWebp, fit, moving, SMALL, squeezable } from "../src/chat/squeeze-fit";

test("fit: a photo to 1440 short, a screen to its pixels, a long shot whole in width, never up", () => {
  expect(fit(4032, 3024)).toEqual({ w: 1920, h: 1440 });
  expect(fit(2880, 1800)).toEqual({ w: 2304, h: 1440 });
  const long = fit(1080, 8000);
  expect(long.w * long.h).toBeLessThanOrEqual(6_000_000);
  expect(long.w).toBeGreaterThan(850);
  expect(fit(800, 600)).toEqual({ w: 800, h: 600 });
  expect(fit(400, 40000).h).toBeLessThanOrEqual(16383);
});

test("asWebp: the name's own end replaced", () => {
  expect(asWebp("shot.png")).toBe("shot.webp");
  expect(asWebp("IMG_0001.JPEG")).toBe("IMG_0001.webp");
  expect(asWebp("a.b.jpg")).toBe("a.b.webp");
  expect(asWebp("noext")).toBe("noext.webp");
  expect(asWebp(".png")).toBe("image.webp");
});

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const chunk = (type: string, n: number) => bytes([0, 0, 0, n], type, new Array(n + 4).fill(0));
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test("moving: an APNG's acTL before its IDAT, a WebP's animation flag", () => {
  const png = (...cs: Uint8Array[]) => new Uint8Array([...PNG, ...cs.flatMap((c) => [...c])]);
  expect(moving(png(chunk("IHDR", 13), chunk("acTL", 8), chunk("IDAT", 10)))).toBe(true);
  expect(moving(png(chunk("IHDR", 13), chunk("IDAT", 10)))).toBe(false);
  expect(moving(png(chunk("IHDR", 13), chunk("IDAT", 10), chunk("acTL", 8)))).toBe(false);
  const webp = (flags: number) => bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8X", [10, 0, 0, 0], [flags, 0, 0, 0]);
  expect(moving(webp(0x02))).toBe(true);
  expect(moving(webp(0x10))).toBe(false);
  expect(moving(bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8 ", [0, 0, 0, 0, 0]))).toBe(false);
  expect(moving(bytes("GIF89a"))).toBe(false);
});

test("squeezable: still pictures past SMALL; a GIF, an SVG, a small one go as they are", () => {
  const f = (type: string, n: number) => new File([new Uint8Array(n)], "x", { type });
  expect(squeezable(f("image/png", SMALL))).toBe(true);
  expect(squeezable(f("image/jpeg", SMALL * 3))).toBe(true);
  expect(squeezable(f("image/png", SMALL - 1))).toBe(false);
  expect(squeezable(f("image/gif", SMALL * 3))).toBe(false);
  expect(squeezable(f("image/svg+xml", SMALL * 3))).toBe(false);
  expect(squeezable(f("application/pdf", SMALL * 3))).toBe(false);
});
