import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import type { AiFeatureManifest } from "@chrona/contracts/ai-feature-runtime";
import { db } from "@chrona/db";
import { stableJsonHash, type CreateAiFeatureRunInput } from "../../feature-runtime";
import { PrismaAiFeatureRunStore } from "./prisma-run-store";

const at = "2026-08-01T12:00:00.000Z";
const manifest: AiFeatureManifest = {
  schemaVersion: 1,
  feature: { id: "test.feature", version: 1 },
  description: "Prisma adapter contract test.",
  input: { id: "test.feature.input", version: 1 },
  observations: [],
  actions: [],
  artifacts: [],
  output: { id: "test.feature.output", version: 1 },
  completion: { id: "test.feature.completion", version: 1 },
  supportedTerminalStatuses: ["completed"],
};

function runInput(id: string): CreateAiFeatureRunInput {
  const input = { value: id };
  return {
    id,
    workspaceId: "workspace-runtime-store",
    feature: manifest.feature,
    manifest,
    manifestHash: stableJsonHash(manifest),
    subject: { type: "test.subject", id: `subject-${id}` },
    operation: { kind: "test", operationId: `operation-${id}` },
    input,
    inputHash: stableJsonHash(input),
    objective: {
      statement: "Exercise durable repository fencing.",
      expectedOutcome: "Only the current owner advances state.",
      successCriteria: ["Lease and action CAS remain deterministic."],
      constraints: [],
    },
  };
}

async function resetDb() {
  await db.aiFeatureRunAction.deleteMany();
  await db.aiFeatureRunObservation.deleteMany();
  await db.aiFeatureRun.deleteMany();
}

async function seedWorkspace() {
  await db.workspace.upsert({
    where: { id: "workspace-runtime-store" },
    update: {},
    create: {
      id: "workspace-runtime-store",
      name: "Runtime store test",
      status: "Active",
    },
  });
}

beforeEach(async () => {
  await resetDb();
  await seedWorkspace();
});
afterAll(async () => {
  await resetDb();
  await db.$disconnect();
});

describe("PrismaAiFeatureRunStore lease and action recovery", () => {
  it("heartbeats an owner-fenced lease without advancing stateVersion", async () => {
    const store = new PrismaAiFeatureRunStore();
    const created = await store.createOrRead(runInput("run-heartbeat"));
    const claimed = await store.claim({
      runId: created.run.id,
      expectedStateVersion: created.run.stateVersion,
      leaseOwner: "owner-a",
      leaseExpiresAt: "2026-08-01T12:00:10.000Z",
      now: at,
    });
    expect(claimed).toMatchObject({ stateVersion: 1, leaseOwner: "owner-a" });

    const renewed = await store.heartbeatLease({
      runId: created.run.id,
      leaseOwner: "owner-a",
      leaseExpiresAt: "2026-08-01T12:00:15.000Z",
      now: "2026-08-01T12:00:05.000Z",
    });
    expect(renewed).toMatchObject({ stateVersion: 1, leaseOwner: "owner-a", leaseExpiresAt: "2026-08-01T12:00:15.000Z" });
    await expect(store.heartbeatLease({
      runId: created.run.id,
      leaseOwner: "owner-b",
      leaseExpiresAt: "2026-08-01T12:00:20.000Z",
      now: "2026-08-01T12:00:06.000Z",
    })).resolves.toBeNull();
  });

  it("reclaims one replayable expired action and then fails closed on a second ambiguity", async () => {
    const store = new PrismaAiFeatureRunStore();
    const created = await store.createOrRead(runInput("run-reclaim"));
    const run = await store.claim({
      runId: created.run.id,
      expectedStateVersion: created.run.stateVersion,
      leaseOwner: "owner-a",
      leaseExpiresAt: "2026-08-01T12:01:00.000Z",
      now: at,
    });
    expect(run).not.toBeNull();

    const base = {
      id: "action-reclaim",
      runId: created.run.id,
      callId: "call-1",
      executionKey: "run-reclaim:invoke:call-1",
      action: { id: "test.action", version: 1 },
      input: { value: "one" },
      inputHash: stableJsonHash({ value: "one" }),
      executionSemantics: "domain_idempotent" as const,
      expectedRunStateVersion: run!.stateVersion,
      maxCalls: 1,
    };
    await expect(store.claimAction({
      ...base,
      leaseOwner: "owner-a",
      leaseExpiresAt: "2026-08-01T12:00:10.000Z",
      now: at,
    })).resolves.toMatchObject({ kind: "claimed", action: { attempt: 1, status: "executing" } });

    await expect(store.claimAction({
      ...base,
      leaseOwner: "owner-a",
      leaseExpiresAt: "2026-08-01T12:00:20.000Z",
      now: "2026-08-01T12:00:11.000Z",
    })).resolves.toMatchObject({ kind: "claimed", action: { attempt: 2, status: "executing" } });

    await expect(store.claimAction({
      ...base,
      leaseOwner: "owner-a",
      leaseExpiresAt: "2026-08-01T12:00:30.000Z",
      now: "2026-08-01T12:00:21.000Z",
    })).resolves.toMatchObject({ kind: "outcome_unknown", action: { attempt: 2, status: "outcome_unknown", error: { code: "action_outcome_unknown" } } });
  });

  it("never replays an expired at-most-once action", async () => {
    const store = new PrismaAiFeatureRunStore();
    const created = await store.createOrRead(runInput("run-at-most-once"));
    const run = await store.claim({
      runId: created.run.id,
      expectedStateVersion: created.run.stateVersion,
      leaseOwner: "owner-a",
      leaseExpiresAt: "2026-08-01T12:01:00.000Z",
      now: at,
    });
    const base = {
      id: "action-at-most-once",
      runId: created.run.id,
      callId: "call-1",
      executionKey: "run-at-most-once:invoke:call-1",
      action: { id: "test.external", version: 1 },
      input: { value: "one" },
      inputHash: stableJsonHash({ value: "one" }),
      executionSemantics: "at_most_once" as const,
      expectedRunStateVersion: run!.stateVersion,
    };
    await store.claimAction({ ...base, leaseOwner: "owner-a", leaseExpiresAt: "2026-08-01T12:00:10.000Z", now: at });
    await expect(store.claimAction({ ...base, leaseOwner: "owner-a", leaseExpiresAt: "2026-08-01T12:00:20.000Z", now: "2026-08-01T12:00:11.000Z" }))
      .resolves.toMatchObject({ kind: "outcome_unknown", action: { attempt: 1, status: "outcome_unknown" } });
  });

  it("pins one immutable provider client and rejects a competing recovery binding", async () => {
    const store = new PrismaAiFeatureRunStore();
    const created = await store.createOrRead(runInput("run-provider-pin"));
    await Promise.all([
      db.aiClient.upsert({
        where: { id: "client-original" },
        update: {},
        create: { id: "client-original", name: "Original", type: "fake-original", config: { model: "original" } },
      }),
      db.aiClient.upsert({
        where: { id: "client-current-default" },
        update: {},
        create: { id: "client-current-default", name: "Current", type: "fake-current", config: { model: "current" } },
      }),
    ]);
    const original = {
      providerClientId: "client-original",
      providerName: "fake-original",
      providerConfigFingerprint: stableJsonHash({ model: "original" }),
    };

    await expect(store.pinProviderBinding({ runId: created.run.id, ...original })).resolves.toMatchObject(original);
    await expect(store.pinProviderBinding({
      runId: created.run.id,
      providerClientId: "client-current-default",
      providerName: "fake-current",
      providerConfigFingerprint: stableJsonHash({ model: "current" }),
    })).rejects.toThrow("pinned to a different provider client");
    await expect(store.getById(created.run.id)).resolves.toMatchObject(original);
  });
});
