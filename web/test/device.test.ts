// The device's own cache (docs/plan.md "本机缓存"): what a sweep lets go, what the worker keeps,
// and that the worker and the page have one database.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DB, DB_VERSION, DEFAULTS, IMAGES, plan, STORES, usageOf, type Entry } from "../src/device/store";

const DAY = 86_400_000;
const MB = 1024 * 1024;
const now = 100 * DAY;
const e = (key: string, size: number, daysAgo: number, cat: Entry["cat"] = "image"): Entry => ({ key, cat, size, used: now - daysAgo * DAY });

describe("a sweep", () => {
  test("lets go of what was not used for the days kept", () => {
    const es = [e("a", 1, 8), e("b", 1, 6.9), e("c", 1, 7.01, "chat"), e("d", 1, 0)];
    expect(plan(es, now, DEFAULTS).sort()).toEqual(["a", "c"]);
    expect(plan(es, now, { ...DEFAULTS, days: 1 }).sort()).toEqual(["a", "b", "c"]);
  });
  test("past the size, the least lately used first, till the rest is within it", () => {
    const es = [e("new", 60 * MB, 0), e("old", 60 * MB, 3), e("mid", 60 * MB, 1, "face"), e("chat", 30 * MB, 2, "chat")];
    // 210 MB over 200: the oldest alone.
    expect(plan(es, now, DEFAULTS)).toEqual(["old"]);
    // Within 100: old, chat, mid let go, new left.
    expect(plan(es, now, { ...DEFAULTS, capMB: 100 })).toEqual(["old", "chat", "mid"]);
    expect(plan(es, now, { ...DEFAULTS, capMB: 1000 })).toEqual([]);
  });
  test("the old ones out first count no more toward the size", () => {
    const es = [e("stale", 150 * MB, 9), e("a", 100 * MB, 1), e("b", 90 * MB, 0)];
    expect(plan(es, now, DEFAULTS)).toEqual(["stale"]);
  });
});

test("the usage by kind", () => {
  expect(usageOf([e("a", 10, 0), e("b", 5, 0, "face"), e("c", 7, 0, "image"), e("d", 3, 0, "chat")])).toEqual({
    image: { n: 2, bytes: 17 },
    face: { n: 1, bytes: 5 },
    chat: { n: 1, bytes: 3 },
  });
});

describe("the worker", () => {
  const src = readFileSync(join(__dirname, "../public/sw.js"), "utf8");
  const worker = new Function("self", `${src}; return { category, IMAGES, DB, DB_VERSION, STORES };`)({ addEventListener() {} }) as {
    category: (p: string) => string | null;
    IMAGES: string;
    DB: string;
    DB_VERSION: number;
    STORES: string[];
  };
  test("has the page's database and cache", () => {
    expect([worker.IMAGES, worker.DB, worker.DB_VERSION, worker.STORES]).toEqual([IMAGES, DB, DB_VERSION, [...STORES]]);
  });
  test("keeps the faces and the pictures, nothing else", () => {
    const kinds = {
      "/v1/internal/channels/abc/avatar": "face",
      "/v1/internal/channels/abc/background": "face",
      "/v1/internal/people/u1/background": "face",
      "/v1/internal/roles/r1/avatar": "face",
      "/_ir/avatar/bot": "face",
      "/v1/internal/face": "face",
      "/v1/internal/sessions/s1/image": "image",
      "/v1/internal/sessions/s1/files/f1/thumb": "image",
      "/v1/internal/sessions/s1/files/f1": null,
      "/v1/internal/sessions/s1": null,
      "/v1/internal/uploads/u1": null,
      "/assets/index.js": null,
      "/": null,
    };
    for (const [path, kind] of Object.entries(kinds)) expect([path, worker.category(path)]).toEqual([path, kind]);
  });
});
