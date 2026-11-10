import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorizeAgentRequest } from "./agent-application";
import { runtimeCall } from "./local-runtime";
import { createRuns } from "./runs";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

for (const boundary of ["agent", "provider"] as const) test.each([
  [null, null, true], [null, 30_000, true],
  [1, null, false], [1, 60_001, false], [1, 60_000, true], [1, 30_000, true],
] as const)(`${boundary} start timeout=%s deadline offset=%s accepted=%s`, async (minutes, offset, accepted) => {
  const db = testDb(), dataDir = await mkdtemp(join(tmpdir(), "chrona-deadline-auth-"));
  const now = new Date("2026-10-15T04:00:00Z"), seen: (Date | null)[] = [];
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null, provider: {
    name: "fixture", async health() { return { available: true, sandboxed: false, error: null }; },
    start(input) { seen.push(input.deadline); return { done: Promise.resolve({ outcome: "finished", sessionId: null, error: null }), async inject() {}, async abort() {} }; },
  } };
  try {
    const workspaceId = (await db.workspace.create({ data: { name: "deadline auth", settings: { runTimeoutMinutes: minutes } } })).id;
    const sessionId = (await db.session.create({ data: { workspaceId, key: "web:test", source: "web" } })).id;
    const runs = createRuns(ports, workspaceId);
    await runs.enqueue({ sessionId, lane: "foreground", trigger: "message", prompt: "Work" });
    const run = (await runs.claimNext("foreground"))!;
    const deadline = offset === null ? null : new Date(now.getTime() + offset).toISOString();
    const input = { operationId: run.id, runId: run.id, token: run.token, lane: run.lane, cwd: run.cwd, sessionDir: run.cwd, sessionId: null, prompt: run.prompt, systemPrompt: "", resources: "minimal", deadline };
    const start = boundary === "agent"
      ? authorizeAgentRequest(ports, workspaceId, "start", { input: JSON.stringify(input) }, { kind: "kernel" })
      : runtimeCall(ports, workspaceId, "agent.start", input);
    if (accepted) {
      await start;
      expect(await db.providerLaunch.count({ where: { runId: run.id } })).toBe(1);
      if (boundary === "provider") {
        expect(seen).toEqual([deadline === null ? null : new Date(deadline)]);
        await runtimeCall(ports, workspaceId, "agent.wait", { operationId: run.id });
        await runtimeCall(ports, workspaceId, "agent.release", { operationId: run.id });
      }
    } else {
      await expect(start).rejects.toMatchObject({ code: "forbidden" });
      expect(seen).toEqual([]);
      expect(await db.providerLaunch.count({ where: { runId: run.id } })).toBe(0);
    }
    expect(await db.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ deadlineAt: run.deadlineAt, leaseUntil: run.leaseUntil });
  } finally { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
});
