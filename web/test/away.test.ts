import { expect, test } from "vitest";
import { awayOf, folderName } from "../src/chat/awayof";

test("away: only where the agent is not in the channel's folder", () => {
  const home = { cwd: "/home/k/ir" };
  expect(awayOf(home, { cwd: "/home/k/ir" })).toBeUndefined();
  expect(awayOf(home, { cwd: "/home/k/ir/" })).toBeUndefined();
  expect(awayOf(home, { cwd: "/home/k/ir/web" })).toEqual({ path: "/home/k/ir/web" });
  expect(awayOf(home, { cwd: "/home/k/ir", machine: "m1" })).toEqual({ machine: "m1", path: "/home/k/ir" });
  expect(awayOf({ cwd: "C:\\Code\\x", machine: "m1" }, { cwd: "C:/Code/x/", machine: "m1" })).toBeUndefined();
  // Not known yet: not away.
  expect(awayOf(undefined, { cwd: "/x" })).toBeUndefined();
  expect(awayOf(home, undefined)).toBeUndefined();
  expect(awayOf({ cwd: "/" }, { cwd: "/" })).toBeUndefined();
});

test("away: a place's name is its last folder", () => {
  expect(folderName("/home/k/rhodium-src/")).toBe("rhodium-src");
  expect(folderName("C:\\Code\\Ds_Benchmark")).toBe("Ds_Benchmark");
  expect(folderName("/")).toBe("/");
});
