import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

import { sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { getChronaDataDir } from "./start-server.js";

export type ChronaDoctorCheck = {
  key: "database" | "databaseIntegrity" | "networkBind" | "apiProtection";
  status: "ok" | "warning" | "error";
  message: string;
};

function configuredDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? `file:${join(getChronaDataDir(), "chrona.db")}`;
}

export function inspectLocalChrona(): ChronaDoctorCheck[] {
  const checks: ChronaDoctorCheck[] = [];
  const databaseUrl = configuredDatabaseUrl();
  const sqlitePath = sqlitePathFromFileUrl(databaseUrl);

  if (!sqlitePath || sqlitePath === ":memory:") {
    checks.push({
      key: "database",
      status: "error",
      message: `Expected a persistent SQLite file URL, got ${databaseUrl}`,
    });
  } else {
    const databasePath = resolve(sqlitePath);
    checks.push({
      key: "database",
      status: existsSync(databasePath) ? "ok" : "warning",
      message: existsSync(databasePath)
        ? `Database found at ${databasePath}`
        : `Database not created yet at ${databasePath}; chrona start will initialize it`,
    });

    if (existsSync(databasePath)) {
      try {
        const db = new Database(databasePath, { readonly: true });
        const result = db.query("PRAGMA quick_check").get() as { quick_check?: string } | null;
        db.close();
        checks.push({
          key: "databaseIntegrity",
          status: result?.quick_check === "ok" ? "ok" : "error",
          message: result?.quick_check === "ok"
            ? "SQLite integrity check passed"
            : "SQLite integrity check failed; stop Chrona and restore a known-good backup",
        });
      } catch (error) {
        checks.push({
          key: "databaseIntegrity",
          status: "error",
          message: `Could not inspect SQLite database: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  const host = process.env.HOST ?? "127.0.0.1";
  const publicBind = host === "0.0.0.0";
  checks.push({
    key: "networkBind",
    status: publicBind ? "warning" : "ok",
    message: publicBind
      ? "Chrona is configured for network access on 0.0.0.0"
      : `Chrona is limited to the local machine on ${host}`,
  });
  checks.push({
    key: "apiProtection",
    status: publicBind && !process.env.API_KEY ? "error" : process.env.API_KEY ? "ok" : "warning",
    message: process.env.API_KEY
      ? "API_KEY protection is configured"
      : publicBind
        ? "Public bind has no API_KEY; Chrona will refuse to start unless unsafe override is set"
        : "API_KEY is not configured; acceptable only for trusted localhost use",
  });

  return checks;
}
