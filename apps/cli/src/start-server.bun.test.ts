import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findResourceDir, getChronaDataDir, resolveMigrationsDir, startChronaServer } from "./start-server";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  process.env = { ...ORIGINAL_ENV };
});

describe("findResourceDir", () => {
  it("uses the observed cwd and preserves environment, argv0, executable and package priority", () => {
    const root = mkdtempSync(join(tmpdir(), "chrona-resource-path-"));
    const candidates = ["configured", "launcher/resources", "binary/resources", "package/resources", "package"];
    for (const candidate of candidates) mkdirSync(join(root, candidate, "prisma/migrations"), { recursive: true });
    const input = { cwd: root, resourceDir: "configured", argv0: "launcher/chrona", executable: join(root, "binary/chrona"), packageDir: "package" };
    try {
      for (const candidate of candidates) {
        expect(findResourceDir(input)).toBe(candidate === "launcher/resources" || candidate === "binary/resources" ? join(root, candidate) : candidate);
        rmSync(join(root, candidate, "prisma"), { recursive: true });
      }
      expect(findResourceDir(input)).toBe("configured");
      expect(() => findResourceDir({ ...input, packageDir: undefined })).toThrow("process package path is unavailable");
      mkdirSync(join(root, "resources/prisma/migrations"), { recursive: true });
      expect(findResourceDir({ ...input, packageDir: "" })).toBe("resources");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("resolves checkout migrations and keeps packaged resources ahead of source definitions", () => {
    const root = mkdtempSync(join(tmpdir(), "chrona-source-migrations-"));
    const source = join(root, "packages/db/prisma/migrations");
    const packaged = join(root, "prisma/migrations");
    try {
      mkdirSync(source, { recursive: true });
      expect(findResourceDir({ cwd: root, argv0: "missing/chrona", executable: "missing/chrona", packageDir: root })).toBe(root);
      expect(resolveMigrationsDir(root)).toBe(source);
      mkdirSync(packaged, { recursive: true });
      expect(resolveMigrationsDir(root)).toBe(packaged);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("preserves no-argument resolution for a relative resource override", () => {
    process.env.CHRONA_RESOURCE_DIR = "prisma/..";
    expect(findResourceDir()).toBe("prisma/..");
  });
});

describe("startChronaServer", () => {
  it("initializes packaged runtime paths before booting with explicit bind options", async () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-start-server-"));
    const resourceDir = join(import.meta.dir, "../../..");
    const originalLog = console.log;
    const output: string[] = [];
    let booted = false;

    process.env.CHRONA_DATA_DIR = join(directory, "data");
    process.env.CHRONA_CONFIG_DIR = join(directory, "config");
    process.env.CHRONA_RESOURCE_DIR = resourceDir;
    process.env.CHRONA_NO_OPEN = "1";
    delete process.env.CHRONA_MIGRATIONS_DIR;
    delete process.env.DATABASE_URL;
    delete process.env.HOST;
    delete process.env.PORT;
    console.log = (...values: unknown[]) => output.push(values.join(" "));

    try {
      await startChronaServer(async () => {
        booted = true;
        expect(process.env.HOST).toBe("0.0.0.0");
        expect(process.env.PORT).toBe("4310");
        expect(process.env.DATABASE_URL).toBe(`file:${join(getChronaDataDir(), "chrona.db")}`);
        expect(process.env.CHRONA_MIGRATIONS_DIR).toBe(join(resourceDir, "packages/db/prisma/migrations"));
      }, { host: "0.0.0.0", port: "4310", open: false });

      expect(booted).toBe(true);
      // Packaged launch delegates the sole lock/migration ownership to prepareChronaRuntime.
      expect(existsSync(join(getChronaDataDir(), "chrona.db"))).toBe(false);
      expect(output).toContain("🚀 Starting Chrona on http://localhost:4310");
      expect(output).toContain("⚡ Chrona — personal steward");
      if (process.platform !== "win32") {
        expect(statSync(getChronaDataDir()).mode & 0o777).toBe(0o700);
        expect(statSync(join(process.env.CHRONA_CONFIG_DIR!, ".env")).mode & 0o777).toBe(0o600);
      }
    } finally {
      console.log = originalLog;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
