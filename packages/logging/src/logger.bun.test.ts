import { describe, expect, it } from "bun:test";

async function runLoggerSnippet(code: string, env: Record<string, string> = {}) {
  const cleanEnv = { ...process.env };
  delete cleanEnv["CHRONA_LOG_LEVEL"];
  delete cleanEnv["NODE_ENV"];
  const proc = Bun.spawn(["bun", "--eval", code], {
    cwd: process.cwd(),
    env: { ...cleanEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("createChronaLogger", () => {
  it("emits pino json logs with Chrona scope and event", async () => {
    const logs = await runLoggerSnippet(`
      const { createChronaLogger } = await import("./packages/logging/src/index.ts");
      const logger = createChronaLogger("test.scope").child({ requestId: "req-1" });
      logger.info("event.ok", { taskId: "task-1" });
    `);

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "info",
      scope: "test.scope",
      event: "event.ok",
      requestId: "req-1",
      data: { taskId: "task-1" },
    });
    expect(typeof logs[0]?.ts).toBe("string");
  });

  it("filters by CHRONA_LOG_LEVEL and redacts sensitive fields", async () => {
    const logs = await runLoggerSnippet(`
      const { createChronaLogger } = await import("./packages/logging/src/index.ts");
      const logger = createChronaLogger("test.redact");
      logger.info("hidden", { token: "secret-token" });
      logger.error("shown", { token: "secret-token", nested: { apiKey: "secret-key" } });
    `, { CHRONA_LOG_LEVEL: "error" });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "error",
      scope: "test.redact",
      event: "shown",
      data: {
        token: "[Redacted]",
        nested: { apiKey: "[Redacted]" },
      },
    });
  });

  it("keeps development at info unless CHRONA_LOG_LEVEL enables debug", async () => {
    const defaultLogs = await runLoggerSnippet(`
      const { createChronaLogger } = await import("./packages/logging/src/index.ts");
      const logger = createChronaLogger("test.dev.default");
      logger.debug("debug.hidden", { value: 1 });
      logger.info("info.visible", { value: 2 });
    `, { NODE_ENV: "development" });

    expect(defaultLogs).toHaveLength(1);
    expect(defaultLogs[0]).toMatchObject({ level: "info", event: "info.visible" });

    const debugLogs = await runLoggerSnippet(`
      const { createChronaLogger } = await import("./packages/logging/src/index.ts");
      const logger = createChronaLogger("test.dev.debug");
      logger.debug("debug.visible", { value: 1 });
    `, { NODE_ENV: "development", CHRONA_LOG_LEVEL: "debug" });

    expect(debugLogs).toHaveLength(1);
    expect(debugLogs[0]).toMatchObject({
      level: "debug",
      scope: "test.dev.debug",
      event: "debug.visible",
      data: { value: 1 },
    });
  });

  it("defaults to silent during tests", async () => {
    const logs = await runLoggerSnippet(`
      const { createChronaLogger } = await import("./packages/logging/src/index.ts");
      const logger = createChronaLogger("test.silent");
      logger.error("hidden.in.tests");
    `, { NODE_ENV: "test" });

    expect(logs).toEqual([]);
  });

  it("exposes level checks for provider debug wiring", async () => {
    const logs = await runLoggerSnippet(`
      const { createChronaLogger } = await import("./packages/logging/src/index.ts");
      const logger = createChronaLogger("test.levels");
      console.log(JSON.stringify({ debug: logger.isLevelEnabled("debug"), info: logger.isLevelEnabled("info") }));
    `, { CHRONA_LOG_LEVEL: "info" });

    expect(logs).toEqual([{ debug: false, info: true }]);
  });
});
