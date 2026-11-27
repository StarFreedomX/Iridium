// The picture viewer's sums (src/chat/zoom-lib.ts) and preview sizing (src/chat/files.tsx).
import { expect, test } from "vitest";
import { pictureBox } from "../src/chat/files";
import { bound, maxScale, zoomAt } from "../src/chat/zoom-lib";

test("zoomAt keeps the point under the pointer", () => {
  const at = { x: 120, y: -40 };
  const o = zoomAt({ x: 10, y: 5 }, 1, 3, at);
  // The picture's point under `at` before: (at - offset) / 1; after: offset' + that * 3 = at.
  expect(o.x + (at.x - 10) * 3).toBeCloseTo(at.x);
  expect(o.y + (at.y - 5) * 3).toBeCloseTo(at.y);
  expect(zoomAt({ x: 0, y: 0 }, 2, 2, at)).toEqual({ x: 0, y: 0 });
});

test("bound: at most 24px past an edge; a picture narrower than the window stays in the middle", () => {
  expect(bound({ x: 9999, y: -9999 }, 2, 1000, 500, 1200, 800)).toEqual({ x: (2000 - 1200) / 2 + 24, y: -((1000 - 800) / 2 + 24) });
  expect(bound({ x: 50, y: 50 }, 1.5, 400, 300, 1200, 800)).toEqual({ x: 0, y: 0 });
});

test("maxScale: five times its fit, or twice its own pixels if that is more", () => {
  expect(maxScale(1)).toBe(5);
  expect(maxScale(0.25)).toBe(8);
  expect(maxScale(0)).toBe(5);
});

test("pictureBox: normal ratios keep natural aspect without upscaling; extreme strips crop", () => {
  // Normal 16:9 scaled down cleanly within maxW=340, maxH=280.
  expect(pictureBox(1600, 900, 340, 280)).toEqual({ w: 340, h: 191, crop: "none" });
  // Normal 9:16 phone screenshot fits maxH=280 cleanly.
  expect(pictureBox(900, 1600, 340, 280)).toEqual({ w: 158, h: 280, crop: "none" });
  // Small image is not upscaled.
  expect(pictureBox(120, 80, 340, 280)).toEqual({ w: 120, h: 80, crop: "none" });
  // Extreme tall strip (1:6): clamped to readable width, cropped from top.
  expect(pictureBox(400, 2400, 340, 280)).toEqual({ w: 140, h: 280, crop: "top" });
  // Extreme wide banner (8:1): clamped to readable height, cropped around center.
  expect(pictureBox(2400, 300, 340, 280)).toEqual({ w: 340, h: 84, crop: "center" });
  // Unknown dimensions: returns undefined (fallback uncropped).
  expect(pictureBox(undefined, undefined, 340, 280)).toBeUndefined();
});
