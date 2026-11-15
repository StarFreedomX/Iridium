// The invite menu's models at once (kumo, 2026-11-15): what was asked last kept in this browser,
// answered with before the server is; a fresh answer kept over it.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../src/api/client";
import { choicesQ } from "../src/chat/channel/pick";

afterEach(() => (localStorage.clear(), vi.restoreAllMocks()));

describe("an agent kind's choices", () => {
  test("none kept: nothing at first; asked, kept for the next time", async () => {
    const q = choicesQ("claude", { channel: "c1" });
    expect(q.initialData()).toBeUndefined();
    const got = { models: [{ value: "haiku", name: "Haiku" }], efforts: ["low"] };
    vi.spyOn(api, "agentChoices").mockResolvedValue(got as never);
    expect(await q.queryFn()).toEqual(got);
    expect(choicesQ("claude", { channel: "c1" }).initialData()).toEqual(got);
    // Another place, another kind: their own.
    expect(choicesQ("claude", { channel: "c2" }).initialData()).toBeUndefined();
    expect(choicesQ("pi", { channel: "c1" }).initialData()).toBeUndefined();
  });
  test("an answer with no models is not kept over one that has them", async () => {
    const got = { models: [{ value: "haiku", name: "Haiku" }], efforts: [] };
    vi.spyOn(api, "agentChoices").mockResolvedValueOnce(got as never).mockResolvedValueOnce({ models: [], efforts: [] } as never);
    const q = choicesQ("claude", {});
    await q.queryFn();
    await q.queryFn();
    expect(q.initialData()).toEqual(got);
  });
});
