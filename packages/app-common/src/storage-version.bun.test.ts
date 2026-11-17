import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyConvertedStorage as qq } from "../../../.generated/applications/qq/migrate-storage";
import { verifyConvertedStorage as web } from "../../../.generated/applications/web/migrate-storage";
import { verifyConvertedStorage as mind } from "../../../.generated/applications/mind/migrate-storage";
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
const directory = () => { const path = mkdtempSync(join(tmpdir(), "chrona-storage-version-")); temporary.push(path); return path; };

test.each([["qq", qq], ["web", web]] as const)("%s schema 2 accepts converted sessions and refuses legacy JSON", (name, verify) => {
  const dir = directory();
  verify(dir);
  mkdirSync(join(dir, "conversations"));
  writeFileSync(join(dir, "conversations/state.json"), '{"version":1,"sessions":[]}');
  expect(() => verify(dir)).toThrow("offline converter");
  rmSync(join(dir, "conversations/state.json"));
  const db = new Database(join(dir, "conversations/sessions.sqlite"), { create: true });
  db.exec("CREATE TABLE conversations(id TEXT PRIMARY KEY,data TEXT); INSERT INTO conversations VALUES('session','{\"pendingKey\":\"fixed\"}')"); db.close();
  verify(dir);
  const manifest = JSON.parse(readFileSync(join(import.meta.dir, `../../../.generated/applications/${name}/module.json`), "utf8"));
  expect(manifest.data).toEqual({ schema: 2, migrate: "migrate-storage.ts" });
});

test("Mind schema 2 rejects every old journal and leaves converted state unchanged", () => {
  const dir = directory();
  mind(dir);
  mkdirSync(join(dir, "admission"));
  writeFileSync(join(dir, "admission/mind-execution.sqlite"), "legacy");
  expect(() => mind(dir)).toThrow("offline converter");
  rmSync(join(dir, "admission/mind-execution.sqlite"));
  const path = join(dir, "mind.sqlite"), db = new Database(path, { create: true });
  db.exec("CREATE TABLE mind_meta(key TEXT PRIMARY KEY,data TEXT); INSERT INTO mind_meta VALUES('budget','{\"spent\":9}')");db.close();
  const before = readFileSync(path);
  mind(dir);
  expect(readFileSync(path)).toEqual(before);
  const manifest = JSON.parse(readFileSync(join(import.meta.dir, "../../../.generated/applications/mind/module.json"), "utf8"));
  expect(manifest.data).toEqual({ schema: 2, migrate: "migrate-storage.ts" });
});
