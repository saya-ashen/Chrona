import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertSafeBind, readEnv, resetEnvCacheForTests, resolveAllowedOrigins } from "./env";

const tempDirs: string[] = [];

function tempConfig(content: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "chrona-server-env-test-"));
  tempDirs.push(dir);
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}

function resetEnv() {
  delete process.env.HOST;
  delete process.env.PORT;
  delete process.env.API_KEY;
  delete process.env.DATABASE_URL;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.CHRONA_CONFIG_FILE;
  delete process.env.CHRONA_MIGRATIONS_DIR;
  delete process.env.CHRONA_UNSAFE_PUBLIC_BIND;
  delete process.env.CHRONA_UNSAFE_CORS;
  delete process.env.CHRONA_WEB_DIST;
  delete process.env.CHRONA_EXPERIMENTAL_DASHBOARD_AI_SUMMARY;
  resetEnvCacheForTests();
}

describe("server environment safety", () => {
  afterEach(() => {
    resetEnv();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults to local-only binding", () => {
    resetEnv();
    expect(readEnv().HOST).toBe("127.0.0.1");
  });

  it("loads server config file before validating env", () => {
    process.env.CHRONA_CONFIG_FILE = tempConfig({
      server: { host: "0.0.0.0", port: 3200, allowedOrigins: ["http://localhost:3200"], unsafePublicBind: true },
      database: { url: "file:/tmp/chrona-config.db", migrationsDir: "/tmp/chrona-migrations" },
      web: { dist: "/tmp/chrona-web" },
      experimental: { dashboardAiSummary: true },
      security: { apiKey: "from-config" },
    });
    const env = readEnv();

    expect(env.HOST).toBe("0.0.0.0");
    expect(env.PORT).toBe("3200");
    expect(env.ALLOWED_ORIGINS).toBe("http://localhost:3200");
    expect(env.DATABASE_URL).toBe("file:/tmp/chrona-config.db");
    expect(env.CHRONA_WEB_DIST).toBe("/tmp/chrona-web");
    expect(env.CHRONA_EXPERIMENTAL_DASHBOARD_AI_SUMMARY).toBe("1");
    expect(env.API_KEY).toBe("from-config");
  });

  it("keeps env values above server config file values", () => {
    process.env.CHRONA_CONFIG_FILE = tempConfig({ server: { port: 3200 } });
    process.env.PORT = "3109";

    expect(readEnv().PORT).toBe("3109");
  });

  it("allows only loopback binds without an API key or explicit override", async () => {
    const env = readEnv();
    const insecureBind = {
      ...env,
      API_KEY: undefined,
      CHRONA_UNSAFE_PUBLIC_BIND: undefined,
    };

    for (const host of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]) {
      await expect(assertSafeBind({ ...insecureBind, HOST: host })).resolves.toBeUndefined();
    }
    for (const host of ["0.0.0.0", "::", "192.168.1.50"]) {
      await expect(assertSafeBind({ ...insecureBind, HOST: host })).rejects.toThrow(
        "Refusing to start Chrona",
      );
    }

    await expect(assertSafeBind({ ...insecureBind, HOST: "0.0.0.0", API_KEY: "key" }))
      .resolves.toBeUndefined();
    await expect(assertSafeBind({ ...insecureBind, HOST: "::", CHRONA_UNSAFE_PUBLIC_BIND: "1" }))
      .resolves.toBeUndefined();
  });

  it("requires an explicit unsafe override for wildcard CORS", () => {
    const env = readEnv();
    expect(resolveAllowedOrigins({ ...env, ALLOWED_ORIGINS: undefined })).toEqual([]);
    expect(() => resolveAllowedOrigins({ ...env, ALLOWED_ORIGINS: "*" })).toThrow(
      "CHRONA_UNSAFE_CORS=1",
    );
    expect(
      resolveAllowedOrigins({ ...env, ALLOWED_ORIGINS: "*", CHRONA_UNSAFE_CORS: "1" }),
    ).toEqual(["*"]);
  });
});
