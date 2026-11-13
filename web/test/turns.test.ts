import { expect, test } from "vitest";
import { turnsOf, type Row } from "../src/chat/turns";

const row = (key: string, agent: boolean, works?: string): Row<string, string> => ({ key, agent, node: key, ...(works ? { works } : {}) });

test("the agent's rows between two messages are one turn, a call's work one that folds", () => {
  const turns = turnsOf([row("a0", true), row("u1", false), row("a1", true), row("a2", true), row("c1", false, "ch"), row("a3", true), row("a4", true), row("u2", false), row("c2", false, "ch")]);
  expect(turns.map((x) => [x.kind, x.key, x.kind === "one" ? 0 : x.rows.length])).toEqual([
    ["agent", "start:a", 1],
    ["one", "u1", 0],
    ["agent", "u1:a", 2],
    ["works", "c1", 2],
    ["one", "u2", 0],
    ["works", "c2", 0],
  ]);
});
