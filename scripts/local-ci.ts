#!/usr/bin/env bun

import { $ } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type LocalCiEnvironment = {
  databaseUrl: string;
  databasePath: string;
  cleanup: () => void;
};

export function createLocalCiEnvironment(): LocalCiEnvironment {
  const directory = mkdtempSync(join(tmpdir(), "chrona-local-ci-"));
  const databasePath = join(directory, "chrona.db");

  return {
    databaseUrl: `file:${databasePath}`,
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

export async function runLocalCi() {
  const environment = createLocalCiEnvironment();
  const env = {
    ...process.env,
    DATABASE_URL: environment.databaseUrl,
  };

  try {
    await $`bun run scripts/init-sqlite-db.ts ${environment.databasePath}`.env(env);
    await $`bun scripts/chrona.ts check all`.env(env);
    await $`bun scripts/chrona.ts test all`.env(env);
  } finally {
    environment.cleanup();
  }
}

if (import.meta.main) {
  await runLocalCi();
}
