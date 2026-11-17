import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { applyChronaRuntimeConfigToEnv, loadChronaRuntimeConfig } from "./runtime-config";

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
      security: { apiKey: "secret" },
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

  it("uses XDG_CONFIG_HOME unless an explicit trimmed path is given", () => {
    const explicitPath = tempConfig({ server: { port: 3200 } });
    const xdgRoot = mkdtempSync(join(tmpdir(), "chrona-config-xdg-test-"));
    tempDirs.push(xdgRoot);
    mkdirSync(join(xdgRoot, "chrona"));
    const xdgPath = join(xdgRoot, "chrona", "config.json");
    writeFileSync(xdgPath, JSON.stringify({ server: { port: 3300 } }));

    expect(loadChronaRuntimeConfig({ XDG_CONFIG_HOME: xdgRoot, CHRONA_CONFIG_FILE: " " }))
      .toEqual({ path: xdgPath, config: { server: { port: 3300 } } });
    expect(loadChronaRuntimeConfig({
      XDG_CONFIG_HOME: xdgRoot,
      CHRONA_CONFIG_FILE: ` ${relative(process.cwd(), explicitPath)} `,
    })).toEqual({ path: explicitPath, config: { server: { port: 3200 } } });
  });

  for (const [field, value] of [["web", { dist: null }], ["experimental", { dashboardAiSummary: true }]] as const) {
    it(`rejects retired ${field} config with path and field diagnostics`, () => {
      const path = tempConfig({ [field]: value });
      expect(() => loadChronaRuntimeConfig({ CHRONA_CONFIG_FILE: path }))
        .toThrow(`Invalid Chrona config ${path}`);
      expect(() => loadChronaRuntimeConfig({ CHRONA_CONFIG_FILE: path })).toThrow(field);
    });
  }

  it("preserves the parser cause for malformed JSON", () => {
    const path = tempConfig({});
    writeFileSync(path, "{");
    let failure: unknown;
    try { loadChronaRuntimeConfig({ CHRONA_CONFIG_FILE: path }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(`Invalid Chrona config ${path}`);
    expect((failure as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it("reports invalid config path and field", () => {
    const path = tempConfig({ server: { port: 70000 } });

    expect(() => loadChronaRuntimeConfig({ CHRONA_CONFIG_FILE: path })).toThrow("server.port");
  });
});
