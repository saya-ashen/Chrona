/**
 * claudeRunEnv — env construction spawned `claude` processes.
 *
 * Drives pure env-builder without spawning `claude`. contract is:
 * - `CHRONA_CLI` ALWAYS set:
 * - caller env override wins
 * - otherwise realpath running chrona entry
 * - caller-passed `cfg.env` overrides respected.
 */

import { describe, expect, test } from "bun:test";

import { claudeRunEnv } from "./runner";

describe("claudeRunEnv — CHRONA_CLI always set", () => {
  test("defaults CHRONA_CLI realpath current chrona entry", () => {
    const env = claudeRunEnv({
      mcpBaseUrl: "http://127.0.0.1:3101",
      mcpRunToken: "tok",
    });
    expect(env.CHRONA_CLI).toBeDefined();
    expect(env.CHRONA_CLI).not.toBe("chrona");
    expect(env.CHRONA_CLI?.startsWith("/")).toBe(true);
    expect(env.CHRONA_BASE_URL).toBeUndefined();
    expect(env.CHRONA_RUN_TOKEN).toBeUndefined();
  });

  test("caller-passed env overrides process.env", () => {
    const env = claudeRunEnv({
      mcpBaseUrl: "http://127.0.0.1:3101",
      mcpRunToken: "tok",
      env: { HOME: "/sandbox", CHRONA_CLI: "/custom/chrona" },
    });
    expect(env.HOME).toBe("/sandbox");
    expect(env.CHRONA_CLI).toBe("/custom/chrona");
  });
});
