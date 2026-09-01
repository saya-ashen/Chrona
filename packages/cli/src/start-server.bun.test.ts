import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getChronaDataDir, startChronaServer } from "./start-server";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  process.env = { ...ORIGINAL_ENV };
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
    delete process.env.CHRONA_WEB_DIST;
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
        expect(process.env.CHRONA_MIGRATIONS_DIR).toBe(join(resourceDir, "prisma", "migrations"));
        expect(process.env.CHRONA_WEB_DIST).toBe(join(resourceDir, "apps/web/dist"));
      }, { host: "0.0.0.0", port: "4310", open: false });

      expect(booted).toBe(true);
      // Packaged launch delegates the sole lock/migration ownership to startBunServer.
      expect(existsSync(join(getChronaDataDir(), "chrona.db"))).toBe(false);
      expect(output).toContain("🚀 Starting Chrona on http://localhost:4310");
      expect(output).toContain("🔌 Chrona MCP: http://127.0.0.1:4310/api/mcp");
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
