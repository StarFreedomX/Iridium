import { describe, expect, it } from "vitest";
import { joinScript, shortVersion } from "../src/apps";

// The 电脑 group's + (apps.tsx): one line a person pastes on the computer that joins.
describe("joinScript", () => {
  it("fetches this Iridium's script and runs it there, the options in its query", () => {
    expect(joinScript("unix", "https://ir.example.com")).toBe("curl -fsSL https://ir.example.com/join | sh");
    expect(joinScript("unix", "https://ir.example.com", "roots=~/work")).toBe("curl -fsSL 'https://ir.example.com/join?roots=~/work' | sh");
    expect(joinScript("win", "https://ir.example.com")).toBe('powershell -c "irm https://ir.example.com/join.ps1 | iex"');
    expect(joinScript("win", "https://ir.example.com", "shell")).toBe(`powershell -c "irm 'https://ir.example.com/join.ps1?shell' | iex"`);
    for (const os of ["unix", "win"] as const) expect(joinScript(os, "https://ir.example.com", "shell")).not.toContain("--install");
  });
});

it("an agent's version on a computer's row: its number alone", () => {
  expect(shortVersion("2.1.34 (Claude Code)")).toBe("2.1.34");
  expect(shortVersion("codex-cli 0.45.0")).toBe("0.45.0");
  expect(shortVersion("")).toBe("");
  expect(shortVersion(undefined)).toBe("");
});
