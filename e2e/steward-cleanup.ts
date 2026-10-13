import cleanupE2eDatabase from "./cleanup-e2e-db";

export default async function cleanupStewardDatabases() {
  const paths = JSON.parse(process.env.CHRONA_STEWARD_E2E_DATABASES ?? "[]") as string[];
  for (const path of paths) {
    process.env.CHRONA_E2E_GENERATED_DB_PATH = path;
    await cleanupE2eDatabase();
  }
}
