import { test, expect } from "bun:test";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { agentFixture } from "../../../../../scripts/agent-integration/agent-application.fixtures";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { upgradeAgentRelease } from "./module-builtin";
import { moduleIdentity, assertModuleOperation } from "./module-identity";
import { createModulePackages } from "../../../../integrations/src/steward/module-packages";

test("trusted Agent release upgrade preserves data and pause, waits for active runs, and keeps dynamic replacement forbidden", async () => {
  const f = await agentFixture();
  try {
    f.ports.packages = createModulePackages({ timeoutMs: 10_000 });
    const previous = f.module.activeHash;
    const root = join(f.root, "builtin");
    await appendFile(join(root, "agent/index.ts"), "\n// next verified release\n");
    const release = await seedTestModuleRelease(root, "agent");
    await f.ports.db.module.update({ where: { id: f.module.id }, data: { dataSchema: 1, status: "paused" } });
    await expect(upgradeAgentRelease(f.ports, f.workspaceId)).rejects.toThrow("unconfirmed executions");
    expect((await f.ports.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).activeHash).toBe(previous);
    await f.ports.db.run.update({ where: { id: f.input.runId }, data: { status: "finished" } });
    await f.ports.db.run.update({ where: { id: f.input.runId }, data: { status: "failed", stopStatus: "unknown", error: "Execution stop is unconfirmed" } });
    await expect(upgradeAgentRelease(f.ports, f.workspaceId)).rejects.toThrow("unconfirmed executions");
    expect((await f.ports.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).activeHash).toBe(previous);
    await f.ports.db.run.update({ where: { id: f.input.runId }, data: { status: "finished", stopStatus: "confirmed", error: null } });
    await upgradeAgentRelease(f.ports, f.workspaceId);
    const current = await f.ports.db.module.findUniqueOrThrow({ where: { id: f.module.id } });
    expect(current).toMatchObject({ activeHash: release.commit, status: "paused", dataSchema: 1 });
    expect(moduleIdentity(current).capabilities.update).toBe(false);
    expect(() => assertModuleOperation(current, "activate")).toThrow("cannot activate");
    await upgradeAgentRelease(f.ports, f.workspaceId);
    expect(await f.ports.db.moduleVersion.count({ where: { moduleId: f.module.id } })).toBe(2);
    const version = await f.ports.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: f.module.id, hash: release.commit } } });
    expect(version.report).toMatchObject({ dependencies: { npm: true, python: false, packages: {} } });
    expect(await f.ports.db.run.count()).toBe(1);
  } finally { await f.close(); }
}, 30_000);
