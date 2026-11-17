export async function startChrona() {
  const [{ prepareChronaRuntime }, { readEnv, resolvePort, assertSafeBind }, { createLogger }, { redactSensitiveText }] = await Promise.all([
    import("./runtime"), import("@server/config/env"), import("@server/logger"), import("@chrona/logging/redaction"),
  ]);
  const env = readEnv(), log = createLogger("apps.cli");
  await assertSafeBind(env);
  const runtime = await prepareChronaRuntime({ databaseUrl: env.DATABASE_URL, port: resolvePort(env),
    log: message => log.info("database migration", { message }),
    onError: error => log.error("steward tick failed", { code: "STEWARD_TICK_FAILED", message: redactSensitiveText(error instanceof Error ? error.message : String(error)) }),
  });
  let http: { stop(): void };
  try {
    const { startBunHttp } = await import("@server/index.bun");
    http = await startBunHttp(runtime.steward, env);
  }
  catch (error) {
    try { await runtime.stop(); }
    catch (stopError) { log.error("runtime cleanup failed", { error: String(stopError) }); }
    throw error;
  }
  runtime.steward.start();
  let stopping = false;
  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    log.info("shutdown started", { signal });
    const deadline = setTimeout(() => { log.error("shutdown timed out; interrupted work will require recovery", { code: "SHUTDOWN_TIMEOUT" }); process.exit(1); }, 30_000);
    http.stop();
    try { await runtime.stop(); }
    catch (error) { log.error("runtime shutdown failed", { error: String(error) }); clearTimeout(deadline); process.exit(1); }
    clearTimeout(deadline);
    log.info("shutdown complete", { signal });
    process.exit(0);
  }
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });
}

if (import.meta.main) await startChrona();
