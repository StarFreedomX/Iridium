// The conversation's glide (chat/stick.tsx): a spring that keeps its speed when pushed again.
import { describe, expect, test } from "vitest";
import { springAt } from "../src/chat/stick";

describe("the glide's spring", () => {
  const w = 0.025;
  test("comes to rest once, without going past its place", () => {
    const s = { y: 80, v: 0, t: 0 };
    let last = 80;
    for (let t = 0; t <= 400; t += 8) {
      const { y } = springAt(s, t, w);
      expect(y).toBeLessThanOrEqual(last + 1e-9);
      expect(y).toBeGreaterThanOrEqual(0);
      last = y;
    }
    expect(springAt(s, 9 / w, w).y).toBeLessThan(0.2);
  });
  test("pushed again as it moves, it goes on at the speed it had: no standstill", () => {
    const a = { y: 80, v: 0, t: 0 };
    const at = springAt(a, 60, w);
    expect(at.v).toBeLessThan(0); // on its way up
    const b = { y: at.y + 40, v: at.v, t: 60 };
    // A frame later it has moved by about what it moved the frame before.
    const before = springAt(a, 44, w).y - at.y;
    const after = b.y - springAt(b, 76, w).y;
    expect(after).toBeGreaterThan(before * 0.9);
  });
});
