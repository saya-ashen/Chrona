/* eslint-disable max-lines -- SQLite migration verification and application share one fail-closed boundary. */
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
	isLegacyHistoryNormalizations,
	normalizeLegacyMigrationHistory,
	type LegacyHistoryNormalization,
	type MigrationHistoryEntry,
	verifyLegacyHistoryNormalizations,
} from "./sqlite-migration-history-normalizers";
import { createPreUpgradeBackup, type PreUpgradeBackupResult } from "./sqlite-backup";
import { checksumSql, schemaFingerprint } from "./sqlite-schema-fingerprint";
import { assertPrivateStoragePath, ensureSqliteParentDir, secureGeneratedPrivateFile, sqlitePathFromFileUrl } from "./sqlite-url";
export { checksumSql, schemaFingerprint } from "./sqlite-schema-fingerprint";

type AppliedMigration = { applied_steps_count: number; checksum: string; migration_name: string };
type Migration = { checksum: string; name: string; sql: string };

type HistoricalNoOpMigration = {
	appliedStepsCount: 0;
	checksum: string;
	rule: "v0.2.0-duplicate-workspace-user-preference";
};

type PreviousReleaseFixtureProvenance = {
	formatVersion: 1;
	releaseAsset: { sha256: string; url: string };
	releaseTag: string;
	database: { path: string; schemaFingerprint: string; sha256: string };
};

type PreviousReleaseFixture = {
	path: string;
	sha256: string;
	provenancePath: string;
	provenanceSha256: string;
};

export type MigrationReleaseMetadata = {
	formatVersion: 1;
	historicalNoOpMigrations: Record<string, HistoricalNoOpMigration>;
	lastReleasedMigration: string;
	lastReleasedSchemaFingerprint: string;
	lastReleasedVersion: string;
	/** Registered complete legacy histories that may be normalized into this release line. */
	legacyHistoryNormalizations?: Record<string, LegacyHistoryNormalization>;
	mutableReleaseLineMigration: string;
	previousReleaseFixture: PreviousReleaseFixture;
	/** Fingerprint of a fresh install through the sole mutable migration. */
	releaseLineSchemaFingerprint: string;
	releasedMigrationChecksums: Record<string, string>;
	/** Exact public migration checksums and applied-step counts, including known no-op history rows. */
	releasedMigrationHistory: Record<string, MigrationHistoryEntry>;
};

export type EnsureSqliteDatabaseResult = {
	preUpgradeBackup: PreUpgradeBackupResult | null;
};

type EnsureSqliteDatabaseOptions = {
	/** Explicitly resolves an out-of-band schema only if it matches a recorded release. */
	baselineRelease?: string;
	databaseUrl: string;
	/** Called after the verified pre-upgrade recovery point is created. */
	onPreUpgradeBackup?: (backup: PreUpgradeBackupResult) => void;
	log?: (message: string) => void;
	migrationsDir: string;
	reset?: boolean;
};

const MIGRATION_METADATA_FILE = "release-metadata.json";
const SHA256 = /^[a-f0-9]{64}$/;

function hasExecutableStatement(sql: string): boolean {
	return sql
		.split(/\r?\n/)
		.some((line) => line.trim() && !line.trim().startsWith("--"));
}

function createMigrationsTable(db: Database): void {
	db.run(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);
}

function hasMigrationHistoryTable(db: Database): boolean {
	return Boolean(
		db.query("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'").get(),
	);
}

/** Checks whether a persistent database will receive any migration/history amendment before opening it writable. */
function preUpgradeBackupRequired(
	databasePath: string,
	migrations: Migration[],
): { required: boolean; sourceFingerprint: string } {
	const db = new Database(databasePath, { readonly: true });
	try {
		if (!hasMigrationHistoryTable(db)) {
			const required = hasExistingSchema(db);
			return { required, sourceFingerprint: required ? schemaFingerprint(db) : "" };
		}
		const applied = readAppliedMigrations(db);
		const required = migrations.some((migration) => {
			const prior = applied.get(migration.name);
			return !prior || prior.checksum !== migration.checksum;
		});
		return { required, sourceFingerprint: required ? schemaFingerprint(db) : "" };
	} finally {
		db.close();
	}
}

function readAppliedMigrations(db: Database): Map<string, AppliedMigration> {
	// pi-lens-ignore: ast-grep:no-sql-in-code
	const rows = db
		.query("SELECT migration_name, checksum, applied_steps_count FROM _prisma_migrations")
		.all() as AppliedMigration[];
	return new Map(rows.map((row) => [row.migration_name, row]));
}

function hasExistingSchema(db: Database): boolean {
	// pi-lens-ignore: ast-grep:no-sql-in-code
	const row = db
		.query(
			`SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'`,
		)
		.get() as { count: number } | undefined;
	return (row?.count ?? 0) > 0;
}

function loadMigrations(migrationsDir: string): Migration[] {
	if (!existsSync(migrationsDir))
		throw new Error(`Migration directory not found: ${migrationsDir}`);
	const migrations = readdirSync(migrationsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({
			name: entry.name,
			sqlPath: join(migrationsDir, entry.name, "migration.sql"),
		}))
		.filter(({ sqlPath }) => existsSync(sqlPath))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(({ name, sqlPath }) => {
			const sql = readFileSync(sqlPath, "utf8");
			return { checksum: checksumSql(sql), name, sql };
		});
	if (migrations.length === 0)
		throw new Error(`No migrations found in: ${migrationsDir}`);
	return migrations;
}

function readReleaseMetadata(migrationsDir: string): unknown {
	const path = join(migrationsDir, MIGRATION_METADATA_FILE);
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(
			`Invalid migration release metadata at ${path}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPreviousReleaseFixture(
	value: unknown,
): value is PreviousReleaseFixture {
	return (
		isRecord(value) &&
		typeof value.path === "string" &&
		typeof value.sha256 === "string" &&
		SHA256.test(value.sha256) &&
		typeof value.provenancePath === "string" &&
		typeof value.provenanceSha256 === "string" &&
		SHA256.test(value.provenanceSha256)
	);
}

// eslint-disable-next-line complexity -- validates the independently pinned release asset and generated database evidence.
function isPreviousReleaseFixtureProvenance(
	value: unknown,
): value is PreviousReleaseFixtureProvenance {
	return (
		isRecord(value) &&
		value.formatVersion === 1 &&
		typeof value.releaseTag === "string" &&
		isRecord(value.releaseAsset) &&
		typeof value.releaseAsset.url === "string" &&
		typeof value.releaseAsset.sha256 === "string" &&
		SHA256.test(value.releaseAsset.sha256) &&
		isRecord(value.database) &&
		typeof value.database.path === "string" &&
		typeof value.database.sha256 === "string" &&
		SHA256.test(value.database.sha256) &&
		typeof value.database.schemaFingerprint === "string" &&
		SHA256.test(value.database.schemaFingerprint)
	);
}

function isReleasedMigrationChecksums(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((checksum) => typeof checksum === "string" && SHA256.test(checksum));
}

function isMigrationHistory(value: unknown): value is Record<string, MigrationHistoryEntry> {
	return isRecord(value) && Object.entries(value).every(
		([name, entry]) =>
			name.length > 0 &&
			isRecord(entry) &&
			typeof entry.checksum === "string" &&
			SHA256.test(entry.checksum) &&
			typeof entry.appliedStepsCount === "number" &&
			Number.isInteger(entry.appliedStepsCount) &&
			entry.appliedStepsCount >= 0,
	);
}

function isHistoricalNoOpMigrations(value: unknown): value is Record<string, HistoricalNoOpMigration> {
	return isRecord(value) && Object.entries(value).every(
		([name, entry]) =>
			name === "20260707000000_add_workspace_user_preferences" &&
			isRecord(entry) &&
			entry.rule === "v0.2.0-duplicate-workspace-user-preference" &&
			entry.appliedStepsCount === 0 &&
			typeof entry.checksum === "string" &&
			SHA256.test(entry.checksum),
	);
}

// eslint-disable-next-line complexity -- every clause validates a distinct metadata contract.
function isMigrationReleaseMetadata(
	value: unknown,
): value is MigrationReleaseMetadata {
	if (!isRecord(value)) return false;
	return (
		value.formatVersion === 1 &&
		typeof value.lastReleasedVersion === "string" &&
		typeof value.lastReleasedMigration === "string" &&
		typeof value.mutableReleaseLineMigration === "string" &&
		typeof value.lastReleasedSchemaFingerprint === "string" &&
		SHA256.test(value.lastReleasedSchemaFingerprint) &&
		typeof value.releaseLineSchemaFingerprint === "string" &&
		SHA256.test(value.releaseLineSchemaFingerprint) &&
		isLegacyHistoryNormalizations(value.legacyHistoryNormalizations) &&
		isHistoricalNoOpMigrations(value.historicalNoOpMigrations) &&
		isPreviousReleaseFixture(value.previousReleaseFixture) &&
		isReleasedMigrationChecksums(value.releasedMigrationChecksums) &&
		isMigrationHistory(value.releasedMigrationHistory)
	);
}

// eslint-disable-next-line complexity -- validates checksum, history, and no-op invariants together.
function releasedMigrations(
	metadata: MigrationReleaseMetadata,
	migrations: Migration[],
): Migration[] {
	const releasedIndex = migrations.findIndex(
		({ name }) => name === metadata.lastReleasedMigration,
	);
	if (releasedIndex < 0) {
		throw new Error(
			`Migration metadata names missing released migration ${metadata.lastReleasedMigration}`,
		);
	}
	const released = migrations.slice(0, releasedIndex + 1);
	const releasedNames = new Set(released.map(({ name }) => name));
	const declaredNames = Object.keys(metadata.releasedMigrationChecksums);
	if (
		declaredNames.length !== released.length ||
		declaredNames.some((name) => !releasedNames.has(name))
	) {
		throw new Error(
			"Migration metadata must declare every released checksum and no mutable migration",
		);
	}
	const historyNames = Object.keys(metadata.releasedMigrationHistory);
	if (
		historyNames.length !== released.length ||
		historyNames.some((name) => !releasedNames.has(name))
	) {
		throw new Error("Migration metadata must declare exact released migration history");
	}
	for (const migration of released) {
		const recordedChecksum = metadata.releasedMigrationChecksums[migration.name];
		const history = metadata.releasedMigrationHistory[migration.name];
		if (
			!SHA256.test(recordedChecksum) ||
			recordedChecksum !== migration.checksum ||
			history.checksum !== migration.checksum
		) {
			throw new Error(`Released migration checksum mismatch for ${migration.name}`);
		}
		const noOp: HistoricalNoOpMigration | undefined = Object.hasOwn(metadata.historicalNoOpMigrations, migration.name)
			? metadata.historicalNoOpMigrations[migration.name]
			: undefined;
		if (noOp && (noOp.checksum !== migration.checksum || history.appliedStepsCount !== noOp.appliedStepsCount)) {
			throw new Error(`Invalid historical no-op metadata for ${migration.name}`);
		}
	}
	return released;
}

// eslint-disable-next-line complexity -- validates fixture bytes, external release provenance, schema, and historical records.
function verifyPreviousReleaseFixture(
	metadata: MigrationReleaseMetadata,
	released: Migration[],
	migrationsDir: string,
): void {
	const fixturePath = join(migrationsDir, metadata.previousReleaseFixture.path);
	const provenancePath = join(migrationsDir, metadata.previousReleaseFixture.provenancePath);
	if (
		!existsSync(fixturePath) ||
		checksumSql(readFileSync(fixturePath)) !==
			metadata.previousReleaseFixture.sha256
	) {
		throw new Error(
			`Previous-release fixture checksum mismatch: ${fixturePath}`,
		);
	}
	if (
		!existsSync(provenancePath) ||
		checksumSql(readFileSync(provenancePath)) !==
			metadata.previousReleaseFixture.provenanceSha256
	) {
		throw new Error(`Previous-release fixture provenance checksum mismatch: ${provenancePath}`);
	}
	let provenance: unknown;
	try {
		provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
	} catch {
		throw new Error(`Invalid previous-release fixture provenance: ${provenancePath}`);
	}
	if (
		!isPreviousReleaseFixtureProvenance(provenance) ||
		provenance.releaseTag !== `v${metadata.lastReleasedVersion}` ||
		provenance.database.sha256 !== metadata.previousReleaseFixture.sha256 ||
		provenance.database.schemaFingerprint !== metadata.lastReleasedSchemaFingerprint
	) {
		throw new Error(`Previous-release fixture provenance does not attest the recorded release: ${provenancePath}`);
	}
	// SQLite may materialize WAL sidecars even for a read-only handle. Verify a
	// disposable copy so the published fixture remains byte-for-byte immutable.
	const fixtureVerificationDir = mkdtempSync(join(tmpdir(), "chrona-release-fixture-"));
	const fixtureCopy = join(fixtureVerificationDir, "fixture.sqlite");
	cpSync(fixturePath, fixtureCopy);
	const fixture = new Database(fixtureCopy, { readonly: true });
	try {
		if (schemaFingerprint(fixture) !== metadata.lastReleasedSchemaFingerprint) {
			throw new Error(
				`Previous-release fixture schema fingerprint mismatch: ${fixturePath}`,
			);
		}
		const applied = readAppliedMigrations(fixture);
		if (
			applied.size !== released.length ||
			released.some((migration) => {
				const expected = metadata.releasedMigrationHistory[migration.name];
				const entry = applied.get(migration.name);
				if (!entry) return true;
				return entry.checksum !== expected.checksum || entry.applied_steps_count !== expected.appliedStepsCount;
			})
		) {
			throw new Error(`Previous-release fixture migration history mismatch: ${fixturePath}`);
		}
	} finally {
		fixture.close();
		rmSync(fixtureVerificationDir, { recursive: true, force: true });
	}
}

function verifyReleaseLineSchema(
	metadata: MigrationReleaseMetadata,
	migrations: Migration[],
): void {
	const fresh = new Database(":memory:");
	try {
		createMigrationsTable(fresh);
		for (const migration of migrations) {
			if (recordHistoricalNoOpMigration(fresh, metadata, migration)) continue;
			if (hasExecutableStatement(migration.sql)) fresh.run(migration.sql);
		}
		if (schemaFingerprint(fresh) !== metadata.releaseLineSchemaFingerprint) {
			throw new Error("Fresh release-line schema fingerprint mismatch");
		}
	} finally {
		fresh.close();
	}
}

/** Validates the machine-readable immutable/mutable migration release boundary. */
export function verifyMigrationReleaseMetadata(
	migrationsDir: string,
): MigrationReleaseMetadata | undefined {
	const value = readReleaseMetadata(migrationsDir);
	if (value === undefined) return undefined;
	if (!isMigrationReleaseMetadata(value)) {
		throw new Error(
			`Invalid migration release metadata at ${join(migrationsDir, MIGRATION_METADATA_FILE)}`,
		);
	}
	const migrations = loadMigrations(migrationsDir);
	const released = releasedMigrations(value, migrations);
	const mutable = migrations.slice(released.length);
	if (
		mutable.length !== 1 ||
		mutable[0]?.name !== value.mutableReleaseLineMigration
	) {
		throw new Error(
			`Migration metadata requires exactly one mutable release-line migration (${value.mutableReleaseLineMigration}) after ${value.lastReleasedMigration}`,
		);
	}
	verifyPreviousReleaseFixture(value, released, migrationsDir);
	verifyLegacyHistoryNormalizations(value, migrationsDir);
	verifyReleaseLineSchema(value, migrations);
	return value;
}

function baselineMigration(db: Database, migration: Migration, appliedStepsCount = 0): void {
	db.run(
		`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
     VALUES (?, ?, ?, ?, ?)`,
		[randomUUID(), migration.checksum, migration.name, new Date().toISOString(), appliedStepsCount],
	);
}

function recordHistoricalNoOpMigration(
	db: Database,
	metadata: MigrationReleaseMetadata | undefined,
	migration: Migration,
): boolean {
	const rule = metadata?.historicalNoOpMigrations[migration.name];
	if (!rule) return false;
	if (rule.checksum !== migration.checksum) {
		throw new Error(`Invalid historical no-op migration rule for ${migration.name}`);
	}
	const requiredObjects = [
		["table", "WorkspaceUserPreference"],
		["index", "WorkspaceUserPreference_workspaceId_userId_key_key"],
		["index", "WorkspaceUserPreference_userId_key_idx"],
	] as const;
	for (const [type, name] of requiredObjects) {
		const present = db.query("SELECT 1 AS present FROM sqlite_master WHERE type = ? AND name = ?").get(type, name);
		if (!present) {
			throw new Error(
				`Historical v0.2.0 compatibility rule cannot record ${migration.name}: expected ${type} ${name} is absent`,
			);
		}
	}
	baselineMigration(db, migration, rule.appliedStepsCount);
	return true;
}

function baselineReleasedSchema(
	db: Database,
	migrations: Migration[],
	metadata: MigrationReleaseMetadata | undefined,
	release: string | undefined,
): void {
	if (!release) {
		throw new Error(
			"Database contains application tables but no migration history. Refusing to infer a baseline; explicitly resolve a recorded release after verifying its provenance.",
		);
	}
	if (!metadata || release !== metadata.lastReleasedVersion)
		throw new Error(`Cannot baseline unknown migration release ${release}`);
	if (schemaFingerprint(db) !== metadata.lastReleasedSchemaFingerprint) {
		throw new Error(
			`Cannot baseline ${release}: database schema fingerprint does not match the recorded release`,
		);
	}
	const end = migrations.findIndex(
		({ name }) => name === metadata.lastReleasedMigration,
	);
	if (end < 0)
		throw new Error(
			`Cannot baseline ${release}: released migration is unavailable`,
		);
	for (const migration of migrations.slice(0, end + 1))
		baselineMigration(db, migration, metadata.releasedMigrationHistory[migration.name].appliedStepsCount);
}

function historiesMatch(
	actual: Map<string, AppliedMigration>,
	expected: Record<string, MigrationHistoryEntry>,
): boolean {
	const entries = Object.entries(expected);
	return actual.size === entries.length && entries.every(([name, entry]) => {
		const applied = actual.get(name);
		return applied?.checksum === entry.checksum && applied.applied_steps_count === entry.appliedStepsCount;
	});
}

/** Rejects unregistered or altered migration histories before a normalizer can change user data. */
function assertAppliedHistoryRecognized(
	db: Database,
	migrations: Migration[],
	metadata: MigrationReleaseMetadata | undefined,
): void {
	if (!metadata) return;
	const actual = readAppliedMigrations(db);
	if (actual.size === 0) return;
	const currentPrefix = migrations.slice(0, actual.size);
	const isCurrentPrefix = currentPrefix.length === actual.size && currentPrefix.every((migration) => {
		const expected = migration.name === metadata.mutableReleaseLineMigration
			? { checksum: migration.checksum, appliedStepsCount: 1 }
			: metadata.releasedMigrationHistory[migration.name];
		const applied = actual.get(migration.name);
		return Boolean(expected) && applied?.checksum === expected.checksum && applied.applied_steps_count === expected.appliedStepsCount;
	});
	if (isCurrentPrefix) return;
	if (Object.values(metadata.legacyHistoryNormalizations ?? {}).some(
		(normalization) => historiesMatch(actual, normalization.expectedHistory),
	)) return;
	throw new Error("Unrecognized migration history; refusing to repair or apply migrations.");
}

const PIN_TASK_EXECUTION_MIGRATION = "20260728000000_pin_task_execution_model";
const RELEASE_LINE_REPAIR_MIGRATION = "20260822000000_repair_release_line";

function assertReleaseLineRepairSource(
	db: Database,
	metadata: MigrationReleaseMetadata | undefined,
	migration: Migration,
): void {
	if (migration.name !== RELEASE_LINE_REPAIR_MIGRATION || !metadata) return;
	if (schemaFingerprint(db) !== metadata.lastReleasedSchemaFingerprint) {
		throw new Error(
			`Cannot apply ${RELEASE_LINE_REPAIR_MIGRATION}: source schema fingerprint is not the recorded ${metadata.lastReleasedVersion} release.`,
		);
	}
}

function assertReleaseLineRepairTarget(
	db: Database,
	metadata: MigrationReleaseMetadata | undefined,
	migration: Migration,
): void {
	if (migration.name !== RELEASE_LINE_REPAIR_MIGRATION || !metadata) return;
	if (schemaFingerprint(db) !== metadata.releaseLineSchemaFingerprint) {
		throw new Error(
			`Cannot apply ${RELEASE_LINE_REPAIR_MIGRATION}: resulting schema fingerprint does not match the current release line.`,
		);
	}
}

function assertReleaseLineRepairUpgradeReady(db: Database, migration: Migration): void {
	if (migration.name !== RELEASE_LINE_REPAIR_MIGRATION) return;
	const table = db.query("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'TaskPlanTerminalAction'").get();
	if (!table) return;
	const duplicate = db.query(
		`SELECT "nodeAttemptId", COUNT(*) AS "count"
       FROM "TaskPlanTerminalAction"
      GROUP BY "nodeAttemptId"
     HAVING COUNT(*) > 1
      LIMIT 1`,
	).get() as { count: number; nodeAttemptId: string } | null;
	if (duplicate) {
		throw new Error(
			`Cannot apply ${RELEASE_LINE_REPAIR_MIGRATION}: ${duplicate.count} terminal actions exist for node attempt ${duplicate.nodeAttemptId}; operator cleanup is required before enforcing one terminal action per attempt.`,
		);
	}
	const taskPlanRunColumns = db.query(`PRAGMA table_info("TaskPlanRun")`).all() as Array<{ name: string }>;
	const nullExecutionScope = taskPlanRunColumns.some((column) => column.name === "executionScopeId")
		? (db.query(`SELECT "id" FROM "TaskPlanRun" WHERE "executionScopeId" IS NULL LIMIT 1`).get() as { id: string } | null)
		: null;
	if (nullExecutionScope) {
		throw new Error(
			`Cannot apply ${RELEASE_LINE_REPAIR_MIGRATION}: TaskPlanRun ${nullExecutionScope.id} has no executionScopeId; operator cleanup is required before enforcing the non-null execution scope.`,
		);
	}
}

function assertPinTaskExecutionUpgradeReady(
	db: Database,
	migration: Migration,
): void {
	if (migration.name !== PIN_TASK_EXECUTION_MIGRATION) return;
	// pi-lens-ignore: ast-grep:no-sql-in-code
	const table = db
		.query(
			`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'TaskPlanRun'`,
		)
		.get() as { present: number } | null;
	if (!table) return;
	const columns = db.query(`PRAGMA table_info("TaskPlanRun")`).all() as Array<{
		name: string;
	}>;
	if (columns.some((column) => column.name === "workBlockScopeKey")) return;
	if (!columns.some((column) => column.name === "workBlockId")) return;
	// pi-lens-ignore: ast-grep:no-sql-in-code
	const duplicate = db
		.query(
			`SELECT "taskId", "planId", COALESCE("workBlockId", '') AS "scopeKey", COUNT(*) AS "count"
       FROM "TaskPlanRun"
      GROUP BY "taskId", "planId", COALESCE("workBlockId", '')
     HAVING COUNT(*) > 1
      LIMIT 1`,
		)
		.get() as {
		taskId: string;
		planId: string;
		scopeKey: string;
		count: number;
	} | null;
	if (!duplicate) return;
	throw new Error(
		`Cannot apply ${PIN_TASK_EXECUTION_MIGRATION}: duplicate legacy TaskPlanRun scope ${duplicate.taskId}/${duplicate.planId}/${duplicate.scopeKey || "<task>"} requires operator cleanup before migration.`,
	);
}

type ForeignKeyViolation = {
	table: string;
	rowid: number | null;
	parent: string;
	fkid: number;
};

function assertNoForeignKeyViolations(
	db: Database,
	migration: Migration,
): void {
	const violation = db
		.query("PRAGMA foreign_key_check")
		.get() as ForeignKeyViolation | null;
	if (!violation) return;
	throw new Error(
		`Cannot apply ${migration.name}: foreign key violation in ${violation.table} row ${violation.rowid ?? "<without rowid>"} referencing ${violation.parent} (constraint ${violation.fkid}).`,
	);
}

function applyMigration(
	db: Database,
	metadata: MigrationReleaseMetadata | undefined,
	migration: Migration,
): void {
	if (recordHistoricalNoOpMigration(db, metadata, migration)) return;
	const apply = db.transaction(() => {
		assertReleaseLineRepairSource(db, metadata, migration);
		assertReleaseLineRepairUpgradeReady(db, migration);
		assertPinTaskExecutionUpgradeReady(db, migration);
		if (hasExecutableStatement(migration.sql)) db.run(migration.sql);
		assertNoForeignKeyViolations(db, migration);
		assertReleaseLineRepairTarget(db, metadata, migration);
		db.run(
			`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
       VALUES (?, ?, ?, ?, ?)`,
			[
				randomUUID(),
				migration.checksum,
				migration.name,
				new Date().toISOString(),
				1,
			],
		);
	});
	// The folded v0.2.0 upgrade rebuilds parent tables. SQLite ignores PRAGMA
	// foreign_keys changes inside a transaction, so run this one registered line
	// with enforcement disabled before BEGIN and prove every relation afterward.
	const rebuildsParentTables = migration.name === RELEASE_LINE_REPAIR_MIGRATION;
	if (rebuildsParentTables) db.run("PRAGMA foreign_keys = OFF");
	try {
		// DDL and its history row are atomic. Never swallow duplicate-object errors.
		apply();
	} finally {
		if (rebuildsParentTables) db.run("PRAGMA foreign_keys = ON");
	}
}

function assertAppliedMigrationCurrent(options: {
	applied: AppliedMigration;
	metadata: MigrationReleaseMetadata | undefined;
	migration: Migration;
}): void {
	const { applied, metadata, migration } = options;
	if (applied.checksum === migration.checksum) {
		const released = metadata?.releasedMigrationHistory[migration.name];
		if (released && applied.applied_steps_count !== released.appliedStepsCount) {
			throw new Error(
				`Released migration history mismatch for ${migration.name}: expected applied_steps_count ${released.appliedStepsCount}`,
			);
		}
		return;
	}
	throw new Error(
		`Migration checksum mismatch for ${migration.name}. The database was created with different migration SQL.`,
	);
}

function createVerifiedPreUpgradeBackup(
	options: EnsureSqliteDatabaseOptions,
	sqlitePath: string,
	migrations: Migration[],
	metadata: MigrationReleaseMetadata | undefined,
): PreUpgradeBackupResult | null {
	if (sqlitePath === ":memory:" || options.reset || !existsSync(sqlitePath)) return null;
	const preflight = preUpgradeBackupRequired(sqlitePath, migrations);
	if (!preflight.required) return null;
	const targetReleaseLine = metadata?.mutableReleaseLineMigration ?? migrations.at(-1)?.name;
	if (!targetReleaseLine) throw new Error("Chrona cannot identify the target migration release line.");
	const backup = createPreUpgradeBackup({
		databaseUrl: options.databaseUrl,
		sourceFingerprint: preflight.sourceFingerprint,
		targetReleaseLine,
	});
	options.log?.(`  Created verified pre-upgrade backup: ${backup.backupPath}`);
	options.onPreUpgradeBackup?.(backup);
	return backup;
}

function resetSqliteDatabaseWhenRequested(sqlitePath: string, reset: boolean | undefined): void {
	if (sqlitePath !== ":memory:" && reset && existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
}

function applyLoadedMigrations(
	db: Database,
	migrations: Migration[],
	metadata: MigrationReleaseMetadata | undefined,
	options: EnsureSqliteDatabaseOptions,
): void {
	createMigrationsTable(db);
	assertAppliedHistoryRecognized(db, migrations, metadata);
	if (readAppliedMigrations(db).size > 0) {
		normalizeLegacyMigrationHistory({
			db,
			metadata,
			migrationsDir: options.migrationsDir,
			mutableChecksum: migrations.at(-1)?.checksum ?? "",
		});
	}
	if (readAppliedMigrations(db).size === 0 && hasExistingSchema(db)) {
		baselineReleasedSchema(db, migrations, metadata, options.baselineRelease);
	}
	const appliedMigrations = readAppliedMigrations(db);
	for (const migration of migrations) {
		const applied = appliedMigrations.get(migration.name);
		if (applied) {
			assertAppliedMigrationCurrent({ applied, metadata, migration });
			continue;
		}
		options.log?.(`  Running migration: ${migration.name}`);
		applyMigration(db, metadata, migration);
	}
}

export function ensureSqliteDatabase(
	options: EnsureSqliteDatabaseOptions,
): EnsureSqliteDatabaseResult {
	const sqlitePath = sqlitePathFromFileUrl(options.databaseUrl);
	if (!sqlitePath) throw new Error(`Chrona requires a SQLite file URL, got: ${options.databaseUrl}`);
	const migrations = loadMigrations(options.migrationsDir);
	const metadata = verifyMigrationReleaseMetadata(options.migrationsDir);
	resetSqliteDatabaseWhenRequested(sqlitePath, options.reset);
	const databaseExisted = sqlitePath !== ":memory:" && existsSync(sqlitePath);
	if (databaseExisted) assertPrivateStoragePath(sqlitePath);
	if (sqlitePath !== ":memory:") {
		for (const suffix of ["-wal", "-shm"]) {
			if (existsSync(`${sqlitePath}${suffix}`)) assertPrivateStoragePath(`${sqlitePath}${suffix}`);
		}
	}
	const preUpgradeBackup = createVerifiedPreUpgradeBackup(options, sqlitePath, migrations, metadata);
	ensureSqliteParentDir(options.databaseUrl);
	const db = new Database(sqlitePath);
	try {
		db.run("PRAGMA foreign_keys = ON");
		db.run("PRAGMA busy_timeout = 5000");
		if (sqlitePath !== ":memory:") db.run("PRAGMA journal_mode = WAL");
		applyLoadedMigrations(db, migrations, metadata, options);
	} finally {
		db.close();
	}
	if (sqlitePath !== ":memory:") {
		if (!databaseExisted) secureGeneratedPrivateFile(sqlitePath);
		for (const suffix of ["-wal", "-shm"]) {
			if (existsSync(`${sqlitePath}${suffix}`)) secureGeneratedPrivateFile(`${sqlitePath}${suffix}`);
		}
	}
	return { preUpgradeBackup };
}
