import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { checksumSql, ensureSqliteDatabase, verifyMigrationReleaseMetadata } from "../packages/db/src/sqlite-migrations";

type PackageJson = { version?: unknown };
type ReleaseMetadata = {
	lastReleasedVersion: string;
	previousReleaseFixture: {
		path: string;
		sha256: string;
		provenancePath: string;
		provenanceSha256: string;
	};
	releasedMigrationChecksums: Record<string, string>;
};

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function gitShow(root: string, revisionPath: string): Uint8Array {
	const result = Bun.spawnSync(["git", "show", revisionPath], { cwd: root, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(`Release consistency requires locally available ${revisionPath}: ${new TextDecoder().decode(result.stderr).trim()}`);
	}
	return result.stdout;
}

/** Verifies the release candidate and its locally available previous-release migration baseline agree. */
// eslint-disable-next-line complexity -- each condition guards a separate public release contract.
export function checkReleaseConsistency(root = resolve(import.meta.dir, "..")): void {
	const pkg = readJson(resolve(root, "package.json")) as PackageJson;
	if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
		throw new Error("package.json must declare a semantic version");
	}
	const cliPkg = readJson(resolve(root, "packages/cli/package.json")) as PackageJson;
	if (cliPkg.version !== pkg.version) {
		throw new Error(`packages/cli/package.json version ${String(cliPkg.version)} does not match package.json version ${pkg.version}`);
	}
	const migrationsDir = resolve(root, "prisma/migrations");
	const metadata = verifyMigrationReleaseMetadata(migrationsDir) as ReleaseMetadata | undefined;
	if (!metadata) throw new Error("Migration release metadata is required");
	if (Bun.semver.order(pkg.version, metadata.lastReleasedVersion) < 0) {
		throw new Error(`package.json version ${pkg.version} predates lastReleasedVersion ${metadata.lastReleasedVersion}`);
	}

	const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
	if (!new RegExp(`^## ${pkg.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|—|$)`, "m").test(changelog)) {
		throw new Error(`CHANGELOG.md must contain a ${pkg.version} release heading`);
	}
	const roadmap = readFileSync(resolve(root, "docs/en/roadmap.md"), "utf8");
	if (!roadmap.includes(`Current version: ${pkg.version}`)) {
		throw new Error(`docs/en/roadmap.md must name ${pkg.version} as the current version`);
	}

	const tag = `v${metadata.lastReleasedVersion}`;
	for (const [migration, checksum] of Object.entries(metadata.releasedMigrationChecksums)) {
		const currentPath = resolve(migrationsDir, migration, "migration.sql");
		const tagPath = `${tag}:prisma/migrations/${migration}/migration.sql`;
		const currentChecksum = checksumSql(readFileSync(currentPath));
		const tagChecksum = checksumSql(gitShow(root, tagPath));
		if (currentChecksum !== checksum || tagChecksum !== checksum || currentChecksum !== tagChecksum) {
			throw new Error(`Released migration ${migration} differs from ${tag}`);
		}
	}
	const fixtureChecksum = checksumSql(readFileSync(resolve(migrationsDir, metadata.previousReleaseFixture.path)));
	if (fixtureChecksum !== metadata.previousReleaseFixture.sha256) {
		throw new Error("Previous-release fixture checksum does not match release metadata");
	}
	const provenanceChecksum = checksumSql(readFileSync(resolve(migrationsDir, metadata.previousReleaseFixture.provenancePath)));
	if (provenanceChecksum !== metadata.previousReleaseFixture.provenanceSha256) {
		throw new Error("Previous-release fixture provenance checksum does not match release metadata");
	}

	const tempDir = mkdtempSync(join(tmpdir(), "chrona-release-schema-"));
	const freshDatabase = join(tempDir, "fresh.db");
	try {
		ensureSqliteDatabase({ databaseUrl: `file:${freshDatabase}`, migrationsDir });
		const schemaDiff = Bun.spawnSync(
			["bunx", "prisma", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--script"],
			{
				cwd: root,
				env: { ...process.env, DATABASE_URL: `file:${freshDatabase}` },
				stderr: "pipe",
				stdout: "pipe",
			},
		);
		const output = new TextDecoder().decode(schemaDiff.stdout).trim();
		if (schemaDiff.exitCode !== 0 || output !== "-- This is an empty migration.") {
			throw new Error(`Fresh release-line schema differs from prisma/schema.prisma: ${new TextDecoder().decode(schemaDiff.stderr).trim() || output}`);
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

if (import.meta.main) checkReleaseConsistency();
