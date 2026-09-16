import { beforeEach, afterEach, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resetTestDb } from "@chrona/db/test-support";
import { createChronaEngine } from "@chrona/engine";
const requireManagementClient = createChronaEngine().management.authorize;
import { enrollLocalManagementClient, listLocalManagementClients, revokeLocalManagementClient } from "./management";
import { MANAGEMENT_LEGACY_SCOPES } from "@chrona/contracts/api";

const previousMigrations = process.env.CHRONA_MIGRATIONS_DIR;
let directory: string;
beforeEach(async () => { await resetTestDb(); directory = mkdtempSync(join(tmpdir(), "chrona-management-cli-")); process.env.CHRONA_MIGRATIONS_DIR = resolve("prisma/migrations"); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); if (previousMigrations === undefined) delete process.env.CHRONA_MIGRATIONS_DIR; else process.env.CHRONA_MIGRATIONS_DIR = previousMigrations; });
it("enrolls into a private new file, lists no secret, refuses overwrite and revokes", async () => {
  const input = { name: "Codex", publicUrl: "http://localhost:3101", timezone: "Asia/Shanghai", access: "full", tokenFile: join(directory, "codex.token") };
  const result = await enrollLocalManagementClient(input);
  const token = readFileSync(result.tokenFile, "utf8").trim();
  expect((await requireManagementClient(token)).name).toBe("Codex");
  expect((await requireManagementClient(token)).scopes).toEqual([...MANAGEMENT_LEGACY_SCOPES]);
  expect(JSON.stringify(result).includes(token)).toBe(false);
  expect(JSON.stringify(await listLocalManagementClients()).includes(token)).toBe(false);
  if (process.platform !== "win32") expect(statSync(result.tokenFile).mode & 0o777).toBe(0o600);
  await expect(enrollLocalManagementClient(input)).rejects.toThrow();
  expect(await listLocalManagementClients()).toHaveLength(1);
  await revokeLocalManagementClient(result.clientId);
  await expect(requireManagementClient(token)).rejects.toThrow();
});

it("enrolls Goal-only assistant presets without task, execution or approval authority", async () => {
  for (const access of ["assistant-read", "assistant"]) {
    const result = await enrollLocalManagementClient({ name: access, publicUrl: "http://localhost:3101", timezone: "UTC", access, tokenFile: join(directory, `${access}.token`) });
    const identity = await requireManagementClient(readFileSync(result.tokenFile, "utf8").trim());
    expect(identity.scopes).toEqual(access === "assistant-read" ? ["goals:read"] : ["goals:read", "goals:propose"]);
  }
});
