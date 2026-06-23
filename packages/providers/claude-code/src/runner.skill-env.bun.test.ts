/**
 * skillEnv — env construction for spawned `claude` processes.
 *
 * Drives the pure env-builder without spawning `claude`. The contract is:
 *   - `CHRONA_CLI` is ALWAYS set:
 *     - skill mode → absolute path under the mounted skill
 *     - otherwise → realpath of the running chrona binary (the entry
 *       that started this process tree, resolved through symlinks)
 *     - caller env override wins
 *   - `CHRONA_BASE_URL` and `CHRONA_RUN_TOKEN` are set ONLY in skill mode.
 *   - The mounted skill bin is prepended to `PATH` so the agent's `Bash`
 *     tool can resolve `chrona` without an absolute path.
 *   - Caller-passed `cfg.env` overrides are respected.
 */

import { describe, expect, test } from "bun:test";

import type { StartRunInput } from "@chrona/providers-foundation";

import { skillEnv } from "./runner";

const BASE_INPUT: StartRunInput = {
  sessionId: "sess-test",
  instructions: "test",
  input: { type: "text", text: "hi" },
};

describe("skillEnv — CHRONA_CLI is always set", () => {
  test("in skill mode with a mounted skill, CHRONA_CLI points at the absolute skill bin", () => {
    const env = skillEnv(
      {
        mcpBaseUrl: "http://127.0.0.1:3101",
        mcpRunToken: "tok",
        controlPlane: "skill",
        controlBaseUrl: "http://127.0.0.1:3101",
      },
      {
        ...BASE_INPUT,
        control: { baseUrl: "http://127.0.0.1:3101", runToken: "tok" },
      },
      "/tmp/skill-mount-uuid",
    );
    expect(env.CHRONA_CLI).toBe("/tmp/skill-mount-uuid/.claude/skills/chrona-node/bin/chrona");
    expect(env.PATH).toContain("/tmp/skill-mount-uuid/.claude/skills/chrona-node/bin");
    expect(env.CHRONA_BASE_URL).toBe("http://127.0.0.1:3101");
    expect(env.CHRONA_RUN_TOKEN).toBe("tok");
  });

  test("in MCP mode (no skillRoot), CHRONA_CLI is the realpath of the current chrona entry", () => {
    const env = skillEnv(
      {
        mcpBaseUrl: "http://127.0.0.1:3101",
        mcpRunToken: "tok",
        controlPlane: "mcp",
      },
      BASE_INPUT,
      undefined,
    );
    // Bun runs this test file as a script; process.argv[1] resolves to
    // an absolute path under .bun/.../runner.skill-env.bun.test.ts or
    // similar. The contract: it MUST be an absolute path, not the bare
    // "chrona" string.
    expect(env.CHRONA_CLI).toBeDefined();
    expect(env.CHRONA_CLI).not.toBe("chrona");
    expect(env.CHRONA_CLI?.startsWith("/")).toBe(true);
    expect(env.CHRONA_BASE_URL).toBeUndefined();
    expect(env.CHRONA_RUN_TOKEN).toBeUndefined();
  });

  test("in replay/test mode (no skillRoot, no control), CHRONA_CLI is still the realpath of the running entry", () => {
    const env = skillEnv(
      {
        mcpBaseUrl: "http://127.0.0.1:3101",
        mcpRunToken: "tok",
      },
      BASE_INPUT,
    );
    expect(env.CHRONA_CLI).toBeDefined();
    expect(env.CHRONA_CLI?.startsWith("/")).toBe(true);
  });

  test("caller-passed env overrides process.env (so the test can isolate from the host PATH)", () => {
    const env = skillEnv(
      {
        mcpBaseUrl: "http://127.0.0.1:3101",
        mcpRunToken: "tok",
        env: { HOME: "/sandbox" },
      },
      BASE_INPUT,
    );
    expect(env.HOME).toBe("/sandbox");
    expect(env.CHRONA_CLI).toBeDefined();
    expect(env.CHRONA_CLI?.startsWith("/")).toBe(true);
  });

  test("CHRONA_CLI set in caller env is preserved (caller wins over our auto-resolution)", () => {
    const env = skillEnv(
      {
        mcpBaseUrl: "http://127.0.0.1:3101",
        mcpRunToken: "tok",
        env: { CHRONA_CLI: "/custom/chrona" },
      },
      BASE_INPUT,
    );
    expect(env.CHRONA_CLI).toBe("/custom/chrona");
  });

  test("skill-mode PATH prepending keeps the rest of the inherited PATH", () => {
    const env = skillEnv(
      {
        mcpBaseUrl: "http://127.0.0.1:3101",
        mcpRunToken: "tok",
        controlPlane: "skill",
        env: { PATH: "/usr/bin:/bin" },
      },
      {
        ...BASE_INPUT,
        control: { baseUrl: "http://127.0.0.1:3101", runToken: "tok" },
      },
      "/tmp/skill-x",
    );
    expect(env.PATH).toContain("/tmp/skill-x/.claude/skills/chrona-node/bin");
    expect(env.PATH).toContain("/usr/bin");
    expect(env.PATH?.indexOf("/tmp/skill-x/.claude/skills/chrona-node/bin")).toBe(0);
  });
});
