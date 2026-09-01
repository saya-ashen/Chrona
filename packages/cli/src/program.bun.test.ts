import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import cliPackage from "../package.json" with { type: "json" };
import { createProgram, dispatchNodeCommand } from "./program";

const ORIGINAL_ENV = { ...process.env };

function makeFetchMock(impl: (input: string, init: RequestInit) => Promise<Response> | Response) {
  return impl as unknown as typeof fetch;
}

describe("chrona CLI release identity", () => {
  it("reports the package version", () => {
    expect(createProgram().version()).toBe(cliPackage.version);
  });
});

describe("chrona CLI: `chrona node <verb>` skill-mode dispatcher", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.CHRONA_BASE_URL = "http://127.0.0.1:3101";
    process.env.CHRONA_RUN_TOKEN = "tok-test";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) delete process.env[key];
    }
    process.env = { ...ORIGINAL_ENV };
  });

  it("forwards `chrona node fail --error \"boom\"` to POST /agent/control with kind=fail", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = makeFetchMock(async (url, init) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({ ok: true, kind: "fail" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await dispatchNodeCommand(["node", "fail", "--error", "boom"]);
    expect(result.code).toBe(0);
    expect(captured).not.toBeNull();
    expect(captured!.url).toBe("http://127.0.0.1:3101/agent/control");
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok-test");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(captured!.init.body as string)).toEqual({
      kind: "fail",
      payload: { error: "boom" },
    });
    expect(result.stdout).toContain("fail");
    expect(result.stderr).toBe("");
  });

  it("forwards semantic node completion from --result-file", async () => {
    const fixturePath = `${import.meta.dir}/__fixtures__/node-result.json`;
    const findings = [{ key: "verified", content: "Result verified." }];
    await Bun.write(fixturePath, JSON.stringify({ findings }));

    let capturedBody: string | null = null;
    globalThis.fetch = makeFetchMock(async (_url, init) => {
      capturedBody = String(init?.body ?? "");
      return new Response("{}", { status: 200 });
    });

    const result = await dispatchNodeCommand([
      "node", "complete", "--summary", "done", "--result-file", fixturePath,
    ]);
    expect(result.code).toBe(0);
    expect(capturedBody).not.toBeNull();
    expect(JSON.parse(capturedBody!)).toEqual({
      kind: "complete",
      payload: { summary: "done", findings },
    });
  });

  it("rejects unknown node verb with exit code 1 and prints Usage error", async () => {
    const result = await dispatchNodeCommand(["node", "teleport"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Usage error/);
    expect(result.stderr).toMatch(/chrona node complete --summary/);
  });

  it("returns exit code 1 with Config error when env is missing", async () => {
    delete process.env.CHRONA_BASE_URL;
    delete process.env.CHRONA_RUN_TOKEN;

    const result = await dispatchNodeCommand(["node", "fail", "--error", "x"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Config error/);
    expect(result.stderr).toMatch(/CHRONA_BASE_URL/);
  });

  it("forwards `chrona task read` and `chrona plan read` as read-only kinds", async () => {
    const captured: string[] = [];
    globalThis.fetch = makeFetchMock(async (_url, init) => {
      captured.push(String(init?.body ?? ""));
      return new Response("{}", { status: 200 });
    });

    const taskResult = await dispatchNodeCommand(["task", "read"]);
    const planResult = await dispatchNodeCommand(["plan", "read"]);
    expect(taskResult.code).toBe(0);
    expect(planResult.code).toBe(0);
    expect(JSON.parse(captured[0]!)).toEqual({ kind: "task_read", payload: {} });
    expect(JSON.parse(captured[1]!)).toEqual({ kind: "plan_read", payload: {} });
  });
});

describe("chrona CLI database recovery commands", () => {
  it("backs up and restores the configured SQLite database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-cli-recovery-"));
    const databasePath = join(directory, "chrona.db");
    const backupPath = join(directory, "backup.db");
    const originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `file:${databasePath}`;

    try {
      const db = new Database(databasePath);
      db.run('CREATE TABLE "Example" ("value" TEXT NOT NULL)');
      db.run('INSERT INTO "Example" ("value") VALUES (\'before\')');
      db.close();

      await createProgram().parseAsync(["node", "chrona", "backup", backupPath]);

      const changed = new Database(databasePath);
      changed.run('UPDATE "Example" SET "value" = \'after\'');
      changed.close();

      await createProgram().parseAsync(["node", "chrona", "restore", backupPath, "--force"]);

      const restored = new Database(databasePath, { readonly: true });
      expect(restored.query('SELECT "value" FROM "Example"').get()).toEqual({ value: "before" });
      restored.close();
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
