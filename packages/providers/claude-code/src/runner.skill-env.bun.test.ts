/**
 * claudeRunEnv — env construction for spawned `claude` processes.
 */

import { describe, expect, test } from "bun:test";

import { claudeRunEnv } from "./runner";

describe("claudeRunEnv", () => {
  test("sets CHRONA_CLI to the running entry by default", () => {
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

  test("caller env overrides process env", () => {
    const env = claudeRunEnv({
      mcpBaseUrl: "http://127.0.0.1:3101",
      mcpRunToken: "tok",
      env: { HOME: "/sandbox", CHRONA_CLI: "/custom/chrona" },
    });

    expect(env.HOME).toBe("/sandbox");
    expect(env.CHRONA_CLI).toBe("/custom/chrona");
  });
});
