import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";

export function checksumSql(sql: string | Uint8Array): string {
	return createHash("sha256").update(sql).digest("hex");
}

/** Deterministic fingerprint of every application-owned SQLite schema object. */
export function schemaFingerprint(db: Database): string {
	// pi-lens-ignore: ast-grep:no-sql-in-code
	const rows = db
		.query(
			`SELECT type, name, tbl_name, COALESCE(sql, '') AS sql
       FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'
      ORDER BY type, name, tbl_name, sql`,
		)
		.all() as Array<{
		name: string;
		sql: string;
		tbl_name: string;
		type: string;
	}>;
	return checksumSql(
		rows
			.map(
				(row) =>
					`${row.type}\u0000${row.name}\u0000${row.tbl_name}\u0000${row.sql}`,
			)
			.join("\n"),
	);
}
