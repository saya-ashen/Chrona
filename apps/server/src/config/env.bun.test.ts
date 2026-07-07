import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertSafeBind, readEnv, resetEnvCacheForTests } from "./env";

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
  delete process.env.CHRONA_WEB_DIST;
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
      security: { apiKey: "from-config" },
    });
    const env = readEnv();

    expect(env.HOST).toBe("0.0.0.0");
    expect(env.PORT).toBe("3200");
    expect(env.ALLOWED_ORIGINS).toBe("http://localhost:3200");
    expect(env.DATABASE_URL).toBe("file:/tmp/chrona-config.db");
    expect(env.CHRONA_WEB_DIST).toBe("/tmp/chrona-web");
    expect(env.API_KEY).toBe("from-config");
  });

  it("keeps env values above server config file values", () => {
    process.env.CHRONA_CONFIG_FILE = tempConfig({ server: { port: 3200 } });
    process.env.PORT = "3109";

    expect(readEnv().PORT).toBe("3109");
  });

  it("refuses public binding without API_KEY unless explicitly overridden", () => {
    expect(() => assertSafeBind({
      ...readEnv(),
      HOST: "0.0.0.0",
      API_KEY: undefined,
      CHRONA_UNSAFE_PUBLIC_BIND: undefined,
    })).toThrow("Refusing to start Chrona");

    expect(() => assertSafeBind({
      ...readEnv(),
      HOST: "0.0.0.0",
      API_KEY: undefined,
      CHRONA_UNSAFE_PUBLIC_BIND: "1",
    })).not.toThrow();
  });
});
