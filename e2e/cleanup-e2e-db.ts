import { existsSync, rmSync } from "node:fs";

/** Remove only the auto-generated per-invocation E2E database after Playwright stops its web server. */
export default async function cleanupE2eDatabase(): Promise<void> {
  const path = process.env.CHRONA_E2E_GENERATED_DB_PATH;
  if (!path || process.env.CHRONA_E2E_DB_PATH) return;
  for (const suffix of ["", "-wal", "-shm", ".chrona.lock", ".restore.json"]) {
    const candidate = `${path}${suffix}`;
    if (existsSync(candidate)) rmSync(candidate, { force: true });
  }
}
