/**
 * skillEnv — env construction for spawned `claude` processes.
 *
 * Drives the pure env-builder without spawning `claude`. The contract is:
 *   - `CHRONA_CLI` is ALWAYS set:
 *     - caller env override wins
 *     - otherwise realpath of the running chrona entry
 *   - caller-passed `cfg.env` overrides are respected.
 */

import { describe, expect, test } from "bun:test";

import { skillEnv } from "./runner";

describe("skillEnv — CHRONA_CLI is always set", () => {
  test("defaults CHRONA_CLI to the realpath of the current chrona entry", () => {
    const env = skillEnv({
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
    const env = skillEnv({
      mcpBaseUrl: "http://127.0.0.1:3101",
      mcpRunToken: "tok",
      env: { HOME: "/sandbox" },
    });

    expect(env.HOME).toBe("/sandbox");
    expect(env.CHRONA_CLI).toBeDefined();
    expect(env.CHRONA_CLI?.startsWith("/")).toBe(true);
  });

  test("caller-passed CHRONA_CLI is preserved", () => {
    const env = skillEnv({
      mcpBaseUrl: "http://127.0.0.1:3101",
      mcpRunToken: "tok",
      env: { CHRONA_CLI: "/custom/chrona" },
    });

    expect(env.CHRONA_CLI).toBe("/custom/chrona");
  });
});
