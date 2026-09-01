import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { checksumSql, schemaFingerprint } from "./sqlite-schema-fingerprint";

const SHA256 = /^[a-f0-9]{64}$/;

export type MigrationHistoryEntry = {
	appliedStepsCount: number;
	checksum: string;
};

export type LegacyHistoryNormalization = {
	/** The exact source schema required in addition to the complete expected history. */
	fromSchemaFingerprint: string;
	/** Complete, exact legacy history. A matching fingerprint alone is never sufficient. */
	expectedHistory: Record<string, MigrationHistoryEntry>;
	/** Repository-relative SQL used only after both exact source checks pass. */
	path: string;
	sha256: string;
};

export type LegacyHistoryNormalizationMetadata = {
	legacyHistoryNormalizations?: Record<string, LegacyHistoryNormalization>;
	mutableReleaseLineMigration: string;
	releaseLineSchemaFingerprint: string;
	releasedMigrationHistory: Record<string, MigrationHistoryEntry>;
};

type AppliedMigration = MigrationHistoryEntry & { migration_name: string };
type ForeignKeyViolation = { fkid: number; parent: string; rowid: number | null; table: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHistory(value: unknown): value is Record<string, MigrationHistoryEntry> {
	return (
		isRecord(value) &&
		Object.entries(value).every(
			([name, entry]) =>
				name.length > 0 &&
				isRecord(entry) &&
				typeof entry.checksum === "string" &&
				SHA256.test(entry.checksum) &&
				typeof entry.appliedStepsCount === "number" &&
				Number.isInteger(entry.appliedStepsCount) &&
				entry.appliedStepsCount >= 0,
		)
	);
}

export function isLegacyHistoryNormalizations(
	value: unknown,
): value is Record<string, LegacyHistoryNormalization> | undefined {
	if (value === undefined) return true;
	if (!isRecord(value)) return false;
	return Object.entries(value).every(
		([checksum, normalization]) =>
			SHA256.test(checksum) &&
			isRecord(normalization) &&
			typeof normalization.fromSchemaFingerprint === "string" &&
			SHA256.test(normalization.fromSchemaFingerprint) &&
			isHistory(normalization.expectedHistory) &&
			typeof normalization.path === "string" &&
			normalization.path.length > 0 &&
			typeof normalization.sha256 === "string" &&
			SHA256.test(normalization.sha256),
	);
}

export function verifyLegacyHistoryNormalizations(
	metadata: LegacyHistoryNormalizationMetadata,
	migrationsDir: string,
): void {
	for (const [checksum, normalization] of Object.entries(
		metadata.legacyHistoryNormalizations ?? {},
	)) {
		const expectedPath = `${metadata.mutableReleaseLineMigration}/normalizers/${checksum}.sql`;
		if (normalization.path !== expectedPath) {
			throw new Error(`Legacy history normalizer path must be ${expectedPath}`);
		}
		const normalizationPath = join(migrationsDir, normalization.path);
		if (
			!existsSync(normalizationPath) ||
			checksumSql(readFileSync(normalizationPath)) !== normalization.sha256
		) {
			throw new Error(`Legacy history normalizer checksum mismatch: ${normalizationPath}`);
		}
	}
}

function readAppliedHistory(db: Database): Map<string, AppliedMigration> {
	const rows = db
		.query("SELECT migration_name, checksum, applied_steps_count AS appliedStepsCount FROM _prisma_migrations")
		.all() as AppliedMigration[];
	return new Map(rows.map((row) => [row.migration_name, row]));
}

function historiesMatch(
	actual: Map<string, AppliedMigration>,
	expected: Record<string, MigrationHistoryEntry>,
): boolean {
	const expectedEntries = Object.entries(expected);
	return (
		actual.size === expectedEntries.length &&
		expectedEntries.every(([name, entry]) => {
			const applied = actual.get(name);
			return (
				applied?.checksum === entry.checksum &&
				applied.appliedStepsCount === entry.appliedStepsCount
			);
		})
	);
}

function hasExecutableStatement(sql: string): boolean {
	return sql.split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith("--"));
}

function assertNoForeignKeyViolations(db: Database, migrationName: string): void {
	const violation = db.query("PRAGMA foreign_key_check").get() as ForeignKeyViolation | null;
	if (!violation) return;
	throw new Error(
		`Cannot normalize ${migrationName}: foreign key violation in ${violation.table} row ${violation.rowid ?? "<without rowid>"} referencing ${violation.parent} (constraint ${violation.fkid}).`,
	);
}

function currentHistory(metadata: LegacyHistoryNormalizationMetadata, mutableChecksum: string): Record<string, MigrationHistoryEntry> {
	return {
		...metadata.releasedMigrationHistory,
		[metadata.mutableReleaseLineMigration]: { checksum: mutableChecksum, appliedStepsCount: 1 },
	};
}

/**
 * Converts only a registered complete legacy release-line history. Both every
 * checksum/count and the source fingerprint must match before SQL or history is touched.
 */
export function normalizeLegacyMigrationHistory(options: {
	db: Database;
	metadata: LegacyHistoryNormalizationMetadata | undefined;
	migrationsDir: string;
	mutableChecksum: string;
}): boolean {
	const { db, metadata, migrationsDir, mutableChecksum } = options;
	if (!metadata || !metadata.legacyHistoryNormalizations) return false;
	const actual = readAppliedHistory(db);
	for (const normalization of Object.values(metadata.legacyHistoryNormalizations)) {
		if (!historiesMatch(actual, normalization.expectedHistory)) continue;
		if (schemaFingerprint(db) !== normalization.fromSchemaFingerprint) {
			throw new Error(
				"Cannot normalize legacy migration history: complete checksum history matched but database schema fingerprint does not match the registered source",
			);
		}
		const sql = readFileSync(join(migrationsDir, normalization.path), "utf8");
		const normalize = db.transaction(() => {
			if (hasExecutableStatement(sql)) db.run(sql);
			assertNoForeignKeyViolations(db, metadata.mutableReleaseLineMigration);
			if (schemaFingerprint(db) !== metadata.releaseLineSchemaFingerprint) {
				throw new Error("Cannot normalize legacy migration history: resulting schema fingerprint does not match the current release line");
			}
			db.run("DELETE FROM _prisma_migrations");
			for (const [name, entry] of Object.entries(currentHistory(metadata, mutableChecksum))) {
				db.run(
					`INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count") VALUES (lower(hex(randomblob(16))), ?, ?, CURRENT_TIMESTAMP, ?)`,
					[entry.checksum, name, entry.appliedStepsCount],
				);
			}
		});
		// Registered normalizers may rebuild SQLite tables. Disable enforcement before
		// BEGIN (not inside it) and prove foreign-key integrity before publishing history.
		db.run("PRAGMA foreign_keys = OFF");
		try {
			normalize();
		} finally {
			db.run("PRAGMA foreign_keys = ON");
		}
		return true;
	}
	return false;
}
