import { describe, expect, it } from "vitest";
import { joinScript, shortVersion } from "../src/apps";

// The 电脑 group's + (apps.tsx): one line a person pastes on the computer that joins.
describe("joinScript", () => {
  it("is one line: fetches ir-computer for the system, runs it to start at login, the flags last", () => {
    const mac = joinScript("mac", "https://ir.example.com", '--roots "~/work"');
    expect(mac).not.toContain("\n");
    expect(mac).toContain("releases/latest/download/ir-computer-darwin-$(uname -m | sed s/x86_64/amd64/)");
    expect(mac.endsWith(' && ~/.local/bin/ir-computer --install https://ir.example.com --roots "~/work"')).toBe(true);
    const linux = joinScript("linux", "https://ir.example.com");
    expect(linux).toContain("ir-computer-linux-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')");
    expect(linux.endsWith(" && ~/.local/bin/ir-computer --install https://ir.example.com")).toBe(true);
    const win = joinScript("win", "https://ir.example.com", "--shell");
    expect(win).not.toContain("\n");
    expect(win).toContain('$d = "$env:LOCALAPPDATA\\iridium"');
    expect(win).toContain("ir-computer-windows-$a.exe");
    expect(win.endsWith('; & "$d\\ir-computer.exe" --install https://ir.example.com --shell')).toBe(true);
  });
});

it("an agent's version on a computer's row: its number alone", () => {
  expect(shortVersion("2.1.34 (Claude Code)")).toBe("2.1.34");
  expect(shortVersion("codex-cli 0.45.0")).toBe("0.45.0");
  expect(shortVersion("")).toBe("");
  expect(shortVersion(undefined)).toBe("");
});
