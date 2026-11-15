import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../packages/db/src/db";
import { checkSingleArtifact, checkMigrations, evaluatePathHygiene, isIgnoredByDockerignore } from "./check-guardrails";

describe("check-guardrails", () => {
	test("evaluatePathHygiene blocks runtime databases, source snapshots under plans/, and >1MiB blobs", () => {
		const sizes: Record<string, number> = {
			"plans/031-demo/report.md": 2048,
			"plans/031-demo/snapshot/index.ts": 512,
			"plans/031-demo/chrona.db": 4096,
			"apps/server/huge-dump.json": 2 * 1024 * 1024,
			"resources/module-git/web.bundle": 5 * 1024 * 1024,
		};
		const findings = evaluatePathHygiene(Object.keys(sizes), (p) => sizes[p] ?? null);
		expect(findings.map((f) => f.message)).toEqual([
			"Source snapshot or package tree under plans/ pollutes typecheck and search: plans/031-demo/snapshot/index.ts",
			"Runtime database or archive artifact must not be committed: plans/031-demo/chrona.db",
			"Oversized file (2048 KiB > 1024 KiB) staged for commit: apps/server/huge-dump.json",
		]);
	});

	test("isIgnoredByDockerignore honors negation, single-char '?' and character class '[ab]' patterns", () => {
		const rules = [
			"# build rules",
			"build/*",
			"!build/manifest.ts",
			"!build/package-tree.ts",
			"tmp/?.ts",
			"gen/[ab].ts",
		].join("\n");
		expect(isIgnoredByDockerignore("build/manifest.ts", rules)).toBe(false);
		expect(isIgnoredByDockerignore("build/agent-dependencies.ts", rules)).toBe(true);
		expect(isIgnoredByDockerignore("scripts/build-binaries.ts", rules)).toBe(false);
		expect(isIgnoredByDockerignore("tmp/x.ts", rules)).toBe(true);
		expect(isIgnoredByDockerignore("tmp/xy.ts", rules)).toBe(false);
		expect(isIgnoredByDockerignore("gen/a.ts", rules)).toBe(true);
		expect(isIgnoredByDockerignore("gen/c.ts", rules)).toBe(false);
	});

	test("checkMigrations fails explicitly when schema or migration file is missing", () => {
		const root = mkdtempSync(join(tmpdir(), "chrona-guardrail-missing-"));
		try {
			const findings = checkMigrations(root);
			expect(findings).toHaveLength(1);
			expect(findings[0]?.message).toContain("Missing required Prisma schema or initial migration");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("lazy db Proxy preserves 'in' reflection and stable bound method references", () => {
		expect("session" in db).toBe(true);
		expect(db.$connect).toBe(db.$connect);
		expect(Object.keys(db).length).toBeGreaterThan(0);
	});

	test("checkMigrations detects missing table or column in 0001_initial/migration.sql", () => {
		const root = mkdtempSync(join(tmpdir(), "chrona-guardrail-mig-"));
		try {
			Bun.spawnSync(["mkdir", "-p", join(root, "prisma/migrations/0001_initial")]);
			writeFileSync(
				join(root, "prisma/schema.prisma"),
				[
					"model Session {",
					"  id String @id",
					"  status String",
					"}",
				].join("\n"),
			);
			writeFileSync(
				join(root, "prisma/migrations/0001_initial/migration.sql"),
				'CREATE TABLE "Session" ("id" TEXT NOT NULL PRIMARY KEY);',
			);
			const findings = checkMigrations(root);
			expect(findings).toHaveLength(1);
			expect(findings[0]?.message).toContain("Session.status");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});


test("rebuilt ignored artifacts pass while stale bytes or older builds fail", () => {
 const dir = mkdtempSync(join(tmpdir(), "chrona-artifact-check-"));
 try {
  const path = join(dir, "bundle.js"), body = "export const ready = true;";
  writeFileSync(path, body);
  const mtime = statSync(path).mtimeMs;
  const context = { modName: "fixture", relDir: "fixture", dir, buildHint: "bun run build",
   dirtyInputs: ["source.ts"], newestDirtyMtime: mtime - 1 };
  const artifact = { path: "bundle.js", sha256: createHash("sha256").update(body).digest("hex") };
  expect(checkSingleArtifact(context, artifact)).toBeNull();
  expect(checkSingleArtifact({ ...context, newestDirtyMtime: mtime + 1 }, artifact)?.message).toContain("requires rebuilding");
  writeFileSync(path, "stale bytes");
  expect(checkSingleArtifact(context, artifact)?.message).toContain("sha256");
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
