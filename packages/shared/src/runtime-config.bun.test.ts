import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyChronaRuntimeConfigToEnv, isDashboardAiSummaryEnabled, loadChronaRuntimeConfig } from "./runtime-config";

const tempDirs: string[] = [];

function tempConfig(content: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "chrona-config-test-"));
  tempDirs.push(dir);
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime config", () => {
  it("returns empty config when configured file is absent", () => {
    const loaded = loadChronaRuntimeConfig({ CHRONA_CONFIG_FILE: join(tmpdir(), "chrona-missing-config.json") });

    expect(loaded).toEqual({ config: {}, path: null });
  });

  it("loads config file and applies env defaults", () => {
    const path = tempConfig({
      server: { host: "0.0.0.0", port: 3200, allowedOrigins: ["http://localhost:3200"], unsafePublicBind: true },
      database: { url: "file:/tmp/chrona.db", migrationsDir: "/opt/chrona/migrations" },
      web: { dist: "/opt/chrona/web" },
      security: { apiKey: "secret" },
      experimental: { dashboardAiSummary: true },
    });
    const env: NodeJS.ProcessEnv = { CHRONA_CONFIG_FILE: path };

    const loaded = applyChronaRuntimeConfigToEnv(env);

    expect(loaded.path).toBe(path);
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.PORT).toBe("3200");
    expect(env.ALLOWED_ORIGINS).toBe("http://localhost:3200");
    expect(env.CHRONA_UNSAFE_PUBLIC_BIND).toBe("1");
    expect(env.DATABASE_URL).toBe("file:/tmp/chrona.db");
    expect(env.CHRONA_MIGRATIONS_DIR).toBe("/opt/chrona/migrations");
    expect(env.CHRONA_WEB_DIST).toBe("/opt/chrona/web");
    expect(env.CHRONA_EXPERIMENTAL_DASHBOARD_AI_SUMMARY).toBe("1");
    expect(env.API_KEY).toBe("secret");
  });

  it("keeps explicit environment variables above config values", () => {
    const path = tempConfig({ server: { port: 3200 }, database: { url: "file:/tmp/config.db" } });
    const env: NodeJS.ProcessEnv = {
      CHRONA_CONFIG_FILE: path,
      PORT: "9999",
      DATABASE_URL: "file:/tmp/env.db",
    };

    applyChronaRuntimeConfigToEnv(env);

    expect(env.PORT).toBe("9999");
    expect(env.DATABASE_URL).toBe("file:/tmp/env.db");
  });

  it("treats dashboard AI summary as disabled unless config or env enables it", () => {
    const disabledPath = tempConfig({ experimental: { dashboardAiSummary: false } });
    const enabledPath = tempConfig({ experimental: { dashboardAiSummary: true } });

    expect(isDashboardAiSummaryEnabled({ CHRONA_CONFIG_FILE: disabledPath })).toBe(false);
    expect(isDashboardAiSummaryEnabled({ CHRONA_CONFIG_FILE: enabledPath })).toBe(true);
    expect(isDashboardAiSummaryEnabled({ CHRONA_EXPERIMENTAL_DASHBOARD_AI_SUMMARY: "true" })).toBe(true);
  });

  it("reports invalid config path and field", () => {
    const path = tempConfig({ server: { port: 70000 } });

    expect(() => loadChronaRuntimeConfig({ CHRONA_CONFIG_FILE: path })).toThrow("server.port");
  });
});
