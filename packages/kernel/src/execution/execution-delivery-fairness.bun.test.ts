import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import type { ExecutionPrincipal, KernelExecutionStart } from "@chrona/contracts/steward";
import { testDb } from "../__testing__/test-db";
import { createExecutionDelivery } from "./execution-delivery";
import { createExecutionEventStore } from "./execution-event-store";
import { createRuns } from "./runs";
import type { StewardPorts } from "../ports";

test("bounded receiver polls rotate cold held claims and pending controls durably with a frozen clock", async () => {
  const db = testDb({ injectedAgent: false });
  try {
    const workspace = await db.workspace.create({ data: { name: "poll fairness" } });
    const app = await db.module.create({ data: { workspaceId: workspace.id, name: "receiver", activeHash: "receiver-hash" } });
    const callers = await Promise.all([0, 1].map(i => db.module.create({ data: { workspaceId: workspace.id, name: `caller-${i}`, activeHash: `caller-hash-${i}` } })));
    const now = new Date("2026-11-09T10:00:00Z");
    const ports: StewardPorts = { db, now: () => now, dataDir: "/tmp/s5-fair-test", publicUrl: null };
    ports.executionEvents = createExecutionEventStore(ports);
    const service = createExecutionDelivery(ports), receiver = { workspaceId: workspace.id, moduleId: app.id, hash: app.activeHash!, activationId: app.activationId };
    const principal = (i: number): ExecutionPrincipal => ({ workspaceId: workspace.id, ownerId: "owner", caller: { kind: "module", moduleId: callers[i]!.id, hash: callers[i]!.activeHash! } });
    const owner: ExecutionPrincipal = { ...principal(0), caller: { kind: "owner" } };
    const baseline = { kind: "commit" as const, digest: "a".repeat(40) };
    const publicKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    for (let i = 0; i < 3; i++) {
      await service.approveAuthority(owner, { receiver, subjectId: `device-${i}`, epoch: i + 1, keyId: `key-${i}`, publicKey, verifierId: "ed25519", verifierVersion: "1", approvalId: `approval-${i}`, scope: { callerModuleIds: callers.map(c => c.id), targets: [{ targetRef: `target-${i}`, targetRevision: 1, projectRef: `project-${i}`, directoryIdentity: `directory-${i}`, baseline, workspaceModes: ["existing"] }] } });
      const input: KernelExecutionStart = { kind: "execution", workId: `work-${i}`, commandKey: `start-${i}`, goal: "run", placement: { kind: "application", applicationId: app.id, targetRef: `target-${i}`, targetRevision: 1, projectRef: `project-${i}` }, workspace: { mode: "existing", baseline }, queueExpiresAt: "2026-11-09T12:00:00Z", budget: { timeoutMs: 60000, maxToolCalls: 1, maxModelCalls: 1, maxOutputTokens: 100 } };
      await service.admit(principal(i < 2 ? 0 : 1), input);
    }
    const first = await service.poll(receiver, 2);
    expect(first.deliveries).toHaveLength(2);
    for (const d of first.deliveries) {
      const i = Number(d.target.subjectId.at(-1));
      await service.control(principal(i < 2 ? 0 : 1), `work-${i}`, `cancel-${i}`, { operation: "cancel" });
    }
    // The original oldest-two query repeats both old rows forever. Pending
    // controls get the leading slot, while the cold third claim gets the other.
    const cold = [0, 1, 2].find(i => !first.deliveries.some(d => d.target.subjectId === `device-${i}`))!;
    // Claim the third Run without offering it, then cancel before its first
    // receiver poll. Its identity and cancel must still reach the journal.
    await createRuns(ports, workspace.id).claimNext("background", now, { kind: "application" });
    await service.control(principal(cold < 2 ? 0 : 1), `work-${cold}`, "cancel-third", { operation: "cancel" });
    const second = await createExecutionDelivery(ports).poll(receiver, 2);
    expect(second.deliveries.some(d => d.target.subjectId === `device-${cold}` && d.target.epoch === cold + 1 && !d.launchable && d.controls.length === 1)).toBe(true);
    expect(second.deliveries[0]!.controls).toHaveLength(1);
    expect(second.deliveries[0]!.launchable).toBe(false);
    expect(await db.executionDelivery.count({ where: { offeredAt: { not: null } } })).toBe(3);
    const third = second.deliveries.find(d => d.target.subjectId === `device-${cold}`)!;
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const page = await createExecutionDelivery(ports).poll(receiver, 1);
      expect(page.deliveries).toHaveLength(1);
      const d = page.deliveries[0]!;
      seen.add(d.target.subjectId);
      expect(d.controls).toHaveLength(1);
      expect(d.launchable).toBe(false);
    }
    expect(seen.size).toBe(3);
    expect(await db.executionDelivery.findUnique({ where: { id: third.target.deliveryId }, select: { offeredAt: true } })).toMatchObject({ offeredAt: expect.any(Date) });
    await expect(service.poll({ ...receiver, activationId: "other-activation" }, 2)).rejects.toMatchObject({ code: "forbidden" });
  } finally { await db.$disconnect(); }
});
