import { describe, expect, it } from "vitest";
import { installLine, irLine, joinArgs } from "../src/apps";

// The 电脑 group's + (apps.tsx): the lines a person pastes on the computer that joins.
const at = "https://ir.example.com";

describe("joinArgs", () => {
  it("are ir's options for an executor of this Iridium, in order", () => {
    expect(joinArgs(at, { keep: true })).toEqual([
      "start",
      "--no-server",
      "--join",
      at,
    ]);
    expect(
      joinArgs(at, {
        shell: false,
        agents: ["claude", "codex"],
        roots: " ~/work ",
        proxy: true,
      }),
    ).toEqual([
      "serve",
      "--no-server",
      "--join",
      at,
      "--no-shell",
      "--agents",
      "claude,codex",
      "--roots",
      "~/work",
      "--proxy",
    ]);
  });
});

describe("installLine", () => {
  it("installs from GitHub, then runs ir with the args; with proxy, the script of this Iridium", () => {
    expect(installLine("unix", at, joinArgs(at, { keep: true }))).toBe(
      "curl -fsSL https://github.com/kumoSleeping/Iridium/releases/latest/download/install.sh | sh -s -- start --no-server --join https://ir.example.com",
    );
    expect(
      installLine("unix", at, joinArgs(at, { keep: true, proxy: true }), true),
    ).toBe(
      "curl -fsSL 'https://ir.example.com/install?proxy' | sh -s -- start --no-server --join https://ir.example.com --proxy",
    );
    expect(installLine("win", at, joinArgs(at, { keep: true }))).toBe(
      'powershell -c "& ([scriptblock]::Create((irm https://github.com/kumoSleeping/Iridium/releases/latest/download/install.ps1))) start --no-server --join https://ir.example.com"',
    );
  });
  it("quotes a word that needs it, as each shell does", () => {
    expect(
      installLine("unix", at, joinArgs(at, { roots: "~/it's mine" })),
    ).toContain("--roots '~/it'\\''s mine'");
    expect(
      installLine("win", at, joinArgs(at, { roots: "C:\\它's" })),
    ).toContain("--roots 'C:\\它''s'");
  });
});

describe("irLine", () => {
  it("joins with ir join when kept running, else runs ir serve there", () => {
    expect(irLine("unix", at, { keep: true, shell: false })).toBe(
      "ir join https://ir.example.com --no-shell",
    );
    expect(irLine("unix", at, { keep: false })).toBe(
      "ir serve --no-server --join https://ir.example.com",
    );
  });
});
