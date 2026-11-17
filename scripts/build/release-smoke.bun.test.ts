import { expect, test } from "bun:test";
import { releaseSmokeEnvironment } from "./release-smoke";

test("release smoke isolates configuration, database and inherited application credentials", () => {
  const env = releaseSmokeEnvironment("/tmp/smoke/data", "/tmp/smoke/config", {
    PATH: "/usr/bin",
    API_KEY: "inherited-test-key",
    CHRONA_CONFIG_FILE: "/must-not-read/config.json",
    CHRONA_RESOURCE_DIR: "/must-not-use-source-resources",
    CHRONA_PACKAGE_DIR: "/must-not-use-source-package",
    CHRONA_MIGRATIONS_DIR: "/must-not-use-source-migrations",
    CHRONA_PROCESS_HELPER: "/must-not-use-source-guardian",
    CHRONA_SDK: "/must-not-use-source-sdk",
    MODEL_API_KEY: "inherited-model-key",
  });
  expect(env.CHRONA_CONFIG_FILE).toBe("/tmp/smoke/config/config.json");
  expect(env.API_KEY).toBeTruthy();
  expect(env.API_KEY).not.toBe("inherited-test-key");
  expect(env.DATABASE_URL).toBe("file:/tmp/smoke/data/chrona.db");
  expect(env.PATH).toBe("/usr/bin");
  expect(env.HOME).toBe("/tmp/smoke/config");
  expect(env.USERPROFILE).toBe("/tmp/smoke/config");
  for (const name of ["CHRONA_RESOURCE_DIR", "CHRONA_PACKAGE_DIR", "CHRONA_MIGRATIONS_DIR", "CHRONA_PROCESS_HELPER", "CHRONA_SDK", "MODEL_API_KEY"]) {
    expect(env[name]).toBeUndefined();
  }
});
