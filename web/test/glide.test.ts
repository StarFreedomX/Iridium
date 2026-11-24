// The conversation's follow (chat/stick.tsx approach): eased to the end, never past it, and what
// comes meanwhile never makes it stand or slow.
import { describe, expect, test } from "vitest";
import { approach } from "../src/chat/stick";

describe("the follow", () => {
  const tau = 220;
  test("comes to rest once, without going past its place, moving from the first frame", () => {
    let y = 80;
    expect(80 - approach(80, 16, tau)).toBeGreaterThan(4);
    for (let t = 0; t < 2000; t += 16) {
      const n = approach(y, 16, tau);
      expect(n).toBeLessThanOrEqual(y);
      expect(n).toBeGreaterThanOrEqual(0);
      y = n;
    }
    expect(y).toBeLessThan(0.5);
  });
  test("pushed again as it moves, it goes on faster, not from a standstill", () => {
    let y = 80;
    for (let t = 0; t < 60; t += 16) y = approach(y, 16, tau);
    const before = y - approach(y, 16, tau);
    const after = y + 40 - approach(y + 40, 16, tau);
    expect(after).toBeGreaterThan(before);
  });
  test("over frames of any length it ends at the same place", () => {
    expect(approach(approach(100, 10, tau), 22, tau)).toBeCloseTo(approach(100, 32, tau), 9);
  });
});
