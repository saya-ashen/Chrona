/* eslint-disable complexity, max-lines, @typescript-eslint/no-unnecessary-condition -- Durable run storage handles CAS, legacy rows, and canonical projections explicitly. */
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../../errors";
import { createPlanGraphFromCompiledPlan as createRuntimePlanGraphFromCompiledPlan } from "@chrona/graph-runtime";
import type {
  CompiledPlan,
  ExecutionContextSnapshot,
  NodeAttempt,
  NodeResult,
  NodeRuntimeState,
  PlanExecutionResult,
  PlanOutputState,
  PlanGraph,
  PlanRun,
} from "@chrona/contracts/ai";
import { createEmptyResultManifest } from "../results/result-manifest";
import { withPlanExecutionDurability } from "./scheduler-durability";
import {
  EXECUTION_COMMAND_CANONICALIZER,
  EXECUTION_COMMAND_CANONICALIZER_VERSION,
  canonicalReceiptResult,
} from "../kernel/command-receipts";

export function createPlanGraphFromCompiledPlan(input: {
  taskId: string;
  compiledPlan: CompiledPlan;
  existingGraph?: PlanGraph;
  now?: string;
}): PlanGraph {
  return createRuntimePlanGraphFromCompiledPlan(input as Parameters<typeof createRuntimePlanGraphFromCompiledPlan>[0]) as unknown as PlanGraph;
}

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function createEmptyPlanOutput(): PlanOutputState {
  return {
    manifest: createEmptyResultManifest(),
    finalizedResult: null,
    finalization: { status: "Pending", sourceRevision: 0 },
    revision: 0,
    updatedAt: null,
    updatedByNodeId: null,
  };
}

type MutablePlanRuntimeRecord = {
  graph: PlanGraph;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots: ExecutionContextSnapshot[];
  planOutput: PlanOutputState;
};

type PersistedPlanRunRecord = {
  planRun: PlanRun;
  mutableGraph?: MutablePlanRuntimeRecord;
};

type SavedPlanRunState = {
  id: string;
  executionScopeId: string;
  planRun: PlanRun;
  graph: PlanGraph | null;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots: ExecutionContextSnapshot[];
  planOutput: PlanOutputState;
  executionOwnerId: string | null;
  executionOwnerScope: string | null;
  executionLeaseUntil: Date | null;
  executionEpoch: number;
};

function createEmptyPlanRun(compiledPlan: CompiledPlan): PlanRun {
  const createdAt = new Date().toISOString();
  const nodeStates = Object.fromEntries(
    compiledPlan.nodes.map((node) => [
      node.id,
      {
        nodeId: node.id,
        status: "pending",
        attempts: 0,
      } satisfies NodeRuntimeState,
    ]),
  );

  return {
    id: `plan_run_${compiledPlan.editablePlanId}`,
    compiledPlanId: compiledPlan.id,
    editablePlanId: compiledPlan.editablePlanId,
    sourceVersion: compiledPlan.sourceVersion,
    status: "pending",
    nodeStates,
    checkpointResponses: [],
    artifactRefs: [],
    attempts: [],
    createdAt,
  };
}

async function loadCompiledPlanForRun(
  taskId: string,
  planId: string,
  workBlockId: string | null | undefined,
  tx: Prisma.TransactionClient = db,
) {
  const row = await tx.taskPlan.findFirst({
    where: { taskId, planId, workBlockId: workBlockId ?? null },
    select: { compiledPlan: true },
  });

  return (row?.compiledPlan as CompiledPlan | undefined) ?? null;
}


function toPersistedPlanRunRecord(input: {
  existing?: PersistedPlanRunRecord | null;
  compiledPlan: CompiledPlan | null;
  taskId: string;
  graph?: PlanGraph;
  attempts?: NodeAttempt[];
  results?: NodeResult[];
  executionContextSnapshots?: ExecutionContextSnapshot[];
  planOutput?: PlanOutputState;
  planRun?: PlanRun;
}): PersistedPlanRunRecord {
  const existing = input.existing ?? null;
  const existingMutable = existing?.mutableGraph;
  const planRun =
    input.planRun ??
    existing?.planRun ??
    (input.compiledPlan ? createEmptyPlanRun(input.compiledPlan) : null);

  if (!planRun) {
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      "Cannot persist plan run without compiledPlan or existing planRun",
    );
  }

  let mutableGraph = existingMutable;

  if (input.graph) {
    mutableGraph = {
      graph: input.graph,
      attempts: input.attempts ?? existingMutable?.attempts ?? [],
      results: input.results ?? existingMutable?.results ?? [],
      executionContextSnapshots:
        input.executionContextSnapshots ?? existingMutable?.executionContextSnapshots ?? [],
      planOutput: input.planOutput ?? existingMutable?.planOutput ?? createEmptyPlanOutput(),
    };
  } else if (!mutableGraph && input.compiledPlan) {
    mutableGraph = {
      graph: createPlanGraphFromCompiledPlan({
        taskId: input.taskId,
        compiledPlan: input.compiledPlan,
      }) as PlanGraph,
      attempts: [],
      results: [],
      executionContextSnapshots: [],
      planOutput: input.planOutput ?? createEmptyPlanOutput(),
    };
  }

  return {
    planRun,
    ...(mutableGraph ? { mutableGraph } : {}),
  };
}

export async function savePlanRun(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  workBlockId?: string | null;
  run?: PlanRun;
  compiledPlan?: CompiledPlan;
  graph?: PlanGraph;
  attempts?: NodeAttempt[];
  results?: NodeResult[];
  executionContextSnapshots?: ExecutionContextSnapshot[];
  planOutput?: PlanOutputState;
}, tx?: Prisma.TransactionClient): Promise<PlanRun> {
  if (!tx) return withPlanExecutionDurability((client) => savePlanRun(input, client));
  const scopeKey = input.workBlockId ?? "";
  const existingRow = await tx.taskPlanRun.findUnique({
    where: {
      taskId_planId_workBlockScopeKey: {
        taskId: input.taskId,
        planId: input.planId,
        workBlockScopeKey: scopeKey,
      },
    },
  });

  const compiledPlan =
    input.compiledPlan ?? (await loadCompiledPlanForRun(input.taskId, input.planId, input.workBlockId, tx));
  const existingRecord = (existingRow?.planRun as PersistedPlanRunRecord | undefined) ?? null;
  const persistedRecord = toPersistedPlanRunRecord({
    existing: existingRecord,
    compiledPlan,
    taskId: input.taskId,
    graph: input.graph,
    attempts: input.attempts,
    results: input.results,
    executionContextSnapshots: input.executionContextSnapshots,
    planOutput: input.planOutput,
    planRun: input.run,
  });

  const occurrence = input.workBlockId
    ? await tx.taskOccurrence.findUnique({ where: { workBlockId: input.workBlockId }, select: { id: true } })
    : null;
  await tx.taskPlanRun.upsert({
    where: {
      taskId_planId_workBlockScopeKey: {
        taskId: input.taskId,
        planId: input.planId,
        workBlockScopeKey: scopeKey,
      },
    },
    update: {
      workspaceId: input.workspaceId,
      workBlockId: input.workBlockId ?? null,
      occurrenceId: occurrence?.id ?? null,
      planRun: asJsonValue(persistedRecord),
    },
    create: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      workBlockId: input.workBlockId ?? null,
      workBlockScopeKey: scopeKey,
      occurrenceId: occurrence?.id ?? null,
      planId: input.planId,
      planRun: asJsonValue(persistedRecord),
    },
  });

  return persistedRecord.planRun;
}

/**
 * Optimistic-concurrency write for the single-writer kernel. Persists the
 * mutable runtime record only if the row's executionEpoch still matches the
 * value read at the start of the command, then bumps the epoch. Returns
 * committed=false on conflict (a concurrent writer advanced first) so the
 * caller can reload and retry.
 */
export async function savePlanRunGuarded(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  workBlockId?: string | null;
  expectedEpoch: number;
  run?: PlanRun;
  compiledPlan?: CompiledPlan;
  graph: PlanGraph;
  attempts: NodeAttempt[];
  results: NodeResult[];
  executionContextSnapshots: ExecutionContextSnapshot[];
  planOutput?: PlanOutputState;
}, tx?: Prisma.TransactionClient): Promise<{ committed: boolean; planRun: PlanRun }> {
  if (!tx) return withPlanExecutionDurability((client) => savePlanRunGuarded(input, client));
  const existingRow = await tx.taskPlanRun.findUnique({
    where: {
      taskId_planId_workBlockScopeKey: {
        taskId: input.taskId,
        planId: input.planId,
        workBlockScopeKey: input.workBlockId ?? "",
      },
    },
  });
  if (!existingRow) {
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      "Plan run must exist before a guarded execution mutation",
    );
  }

  const compiledPlan =
    input.compiledPlan ??
    (await loadCompiledPlanForRun(input.taskId, input.planId, input.workBlockId, tx));
  const existingRecord =
    (existingRow.planRun as unknown as PersistedPlanRunRecord | undefined) ?? null;
  const persistedRecord = toPersistedPlanRunRecord({
    existing: existingRecord,
    compiledPlan,
    taskId: input.taskId,
    graph: input.graph,
    attempts: input.attempts,
    results: input.results,
    executionContextSnapshots: input.executionContextSnapshots,
    planOutput: input.planOutput,
    planRun: input.run,
  });

  const occurrence = input.workBlockId
    ? await tx.taskOccurrence.findUnique({ where: { workBlockId: input.workBlockId }, select: { id: true } })
    : null;
  const updated = await tx.taskPlanRun.updateMany({
    where: { id: existingRow.id, executionEpoch: input.expectedEpoch },
    data: {
      workspaceId: input.workspaceId,
      workBlockId: input.workBlockId ?? null,
      occurrenceId: occurrence?.id ?? null,
      planRun: asJsonValue(persistedRecord),
      executionEpoch: input.expectedEpoch + 1,
    },
  });

  return { committed: updated.count > 0, planRun: persistedRecord.planRun };
}
const COMMAND_RECEIPT_LEASE_MS = 30_000;
// Short receipt leases prevent a crashed owner from leaving an idempotency key
// permanently claimed. Reclaim CASes on digest/canonicalizer/epoch/owner version,
// while completed receipts always replay before any stale reclaim path.

type CommandReceiptIdentity = {
  planRunId: string;
  commandKey: string;
  commandDigest: string;
  canonicalizer: string;
  canonicalizerVersion: number;
  executionEpoch: number;
  workBlockId: string | null;
  leaseOwnerId: string | null;
  leaseExpiresAt: Date | null;
  claimVersion: number;
};

function assertSameCommandReceipt(
  existing: Pick<CommandReceiptIdentity, "commandDigest" | "canonicalizer" | "canonicalizerVersion">,
  input: Pick<CommandReceiptIdentity, "commandDigest" | "canonicalizer" | "canonicalizerVersion">,
) {
  if (
    existing.commandDigest !== input.commandDigest
    || existing.canonicalizer !== input.canonicalizer
    || existing.canonicalizerVersion !== input.canonicalizerVersion
  ) {
    throw new EngineError(
      ENGINE_ERROR_CODES.CONFLICT,
      "Idempotency key was already used for a different execution command.",
    );
  }
}

function commandClaimFromReceipt(receipt: CommandReceiptIdentity): ClaimedPlanRunCommand {
  if (!receipt.leaseOwnerId || !receipt.leaseExpiresAt) {
    throw new Error("Command receipt claim is missing its durable lease identity");
  }
  return {
    status: "claimed",
    planRunId: receipt.planRunId,
    commandKey: receipt.commandKey,
    commandDigest: receipt.commandDigest,
    canonicalizer: receipt.canonicalizer,
    workBlockId: receipt.workBlockId,
    canonicalizerVersion: receipt.canonicalizerVersion,
    claimedEpoch: receipt.executionEpoch,
    leaseOwnerId: receipt.leaseOwnerId,
    leaseExpiresAt: receipt.leaseExpiresAt,
    claimVersion: receipt.claimVersion,
  };
}

function inFlightClaimFromReceipt(receipt: CommandReceiptIdentity) {
  return {
    status: "in_flight" as const,
    planRunId: receipt.planRunId,
    commandKey: receipt.commandKey,
    commandDigest: receipt.commandDigest,
    canonicalizer: receipt.canonicalizer,
    canonicalizerVersion: receipt.canonicalizerVersion,
    workBlockId: receipt.workBlockId,
    claimedEpoch: receipt.executionEpoch,
    leaseOwnerId: receipt.leaseOwnerId,
    leaseExpiresAt: receipt.leaseExpiresAt,
    claimVersion: receipt.claimVersion,
  };
}

function parseReceiptJson(value: unknown): Prisma.JsonValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value as Prisma.JsonValue;
  try {
    return JSON.parse(value) as Prisma.JsonValue;
  } catch {
    return value as Prisma.JsonValue;
  }
}


async function readCommandReceiptClaim(
  tx: Prisma.TransactionClient,
  planRunId: string,
  commandKey: string,
): Promise<(CommandReceiptIdentity & { status: string; result: Prisma.JsonValue | null }) | null> {
  const rows = await tx.$queryRaw<Array<CommandReceiptIdentity & { status: string; result: unknown }>>`
    SELECT r."planRunId", r."commandKey", r."commandDigest", r."canonicalizer", r."canonicalizerVersion",
           r."executionEpoch", pr."workBlockId", r."leaseOwnerId", r."leaseExpiresAt", r."claimVersion",
           r."status", r."result"
    FROM "TaskPlanCommandReceipt" r
    JOIN "TaskPlanRun" pr ON pr."id" = r."planRunId"
    WHERE r."planRunId" = ${planRunId} AND r."commandKey" = ${commandKey}
    LIMIT 1
  `;
  const receipt = rows[0];
  return receipt ? { ...receipt, leaseExpiresAt: receipt.leaseExpiresAt instanceof Date ? receipt.leaseExpiresAt : receipt.leaseExpiresAt ? new Date(String(receipt.leaseExpiresAt)) : null, result: parseReceiptJson(receipt.result) } : null;
}

async function reclaimStaleCommandReceipt(input: {
  tx: Prisma.TransactionClient;
  existing: CommandReceiptIdentity & { status: string; result: Prisma.JsonValue | null };
  now: Date;
  leaseOwnerId: string;
  leaseExpiresAt: Date;
}): Promise<PlanRunCommandClaim> {
  const reclaimed = await input.tx.$executeRaw`
    UPDATE "TaskPlanCommandReceipt"
    SET "leaseOwnerId" = ${input.leaseOwnerId},
        "leaseExpiresAt" = ${input.leaseExpiresAt},
        "claimVersion" = "claimVersion" + 1
    WHERE "planRunId" = ${input.existing.planRunId}
      AND "commandKey" = ${input.existing.commandKey}
      AND "commandDigest" = ${input.existing.commandDigest}
      AND "canonicalizer" = ${input.existing.canonicalizer}
      AND "canonicalizerVersion" = ${input.existing.canonicalizerVersion}
      AND "executionEpoch" = ${input.existing.executionEpoch}
      AND "claimVersion" = ${input.existing.claimVersion}
      AND "status" = 'claimed'
      AND "result" IS NULL
      AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${input.now})
  `;
  if (reclaimed !== 1) {
    const fresh = await readCommandReceiptClaim(input.tx, input.existing.planRunId, input.existing.commandKey);
    return fresh ? resolveExistingCommandReceipt(fresh, input.existing, input.now) : inFlightClaimFromReceipt(input.existing);
  }
  return commandClaimFromReceipt({
    ...input.existing,
    leaseOwnerId: input.leaseOwnerId,
    leaseExpiresAt: input.leaseExpiresAt,
    claimVersion: input.existing.claimVersion + 1,
  });
}

async function resolveExistingCommandReceipt(
  existing: CommandReceiptIdentity & { status: string; result: Prisma.JsonValue | null },
  input: Pick<CommandReceiptIdentity, "commandDigest" | "canonicalizer" | "canonicalizerVersion">,
  now: Date,
  claimLease?: { tx: Prisma.TransactionClient; leaseOwnerId: string; leaseExpiresAt: Date },
): Promise<PlanRunCommandClaim> {
  assertSameCommandReceipt(existing, input);
  if (existing.status === "completed" && existing.result !== null) {
    return { status: "replayed", result: existing.result as unknown as PlanExecutionResult };
  }
  if (claimLease && (!existing.leaseExpiresAt || existing.leaseExpiresAt <= now)) {
    return reclaimStaleCommandReceipt({ tx: claimLease.tx, existing, now, leaseOwnerId: claimLease.leaseOwnerId, leaseExpiresAt: claimLease.leaseExpiresAt });
  }
  return inFlightClaimFromReceipt(existing);
}
async function readReceiptAfterLostClaim(input: {
  tx: Prisma.TransactionClient;
  planRunId: string;
  commandKey: string;
  commandDigest: string;
  canonicalizer: string;
  canonicalizerVersion: number;
  now: Date;
}): Promise<PlanRunCommandClaim | null> {
  const existing = await readCommandReceiptClaim(input.tx, input.planRunId, input.commandKey);
  return existing ? resolveExistingCommandReceipt(existing, input, input.now) : null;
}


export type ClaimedPlanRunCommand = {
  status: "claimed";
  planRunId: string;
  commandKey: string;
  commandDigest: string;
  canonicalizer: string;
  canonicalizerVersion: number;
  claimedEpoch: number;
  workBlockId: string | null;
  leaseOwnerId: string;
  leaseExpiresAt: Date;
  claimVersion: number;
};

export type PlanRunCommandClaim =
  | ClaimedPlanRunCommand
  | { status: "replayed"; result: PlanExecutionResult }
  | {
      status: "in_flight";
      planRunId: string;
      commandKey: string;
      commandDigest: string;
      canonicalizer: string;
      canonicalizerVersion: number;
      workBlockId: string | null;
      claimedEpoch: number;
      leaseOwnerId: string | null;
      leaseExpiresAt: Date | null;
      claimVersion: number;
    };

export async function claimPlanRunCommand(input: {
  taskId: string;
  planId: string;
  workBlockId?: string | null;
  expectedEpoch: number;
  commandKey: string;
  commandDigest: string;
  leaseOwnerId?: string;
  leaseDurationMs?: number;
}, tx?: Prisma.TransactionClient): Promise<PlanRunCommandClaim | null> {
  if (!tx) return withPlanExecutionDurability((client) => claimPlanRunCommand(input, client));
  const now = new Date();
  const leaseOwnerId = input.leaseOwnerId ?? crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseDurationMs ?? COMMAND_RECEIPT_LEASE_MS));
  const planRun = await tx.taskPlanRun.findUnique({
    where: {
      taskId_planId_workBlockScopeKey: {
        taskId: input.taskId,
        planId: input.planId,
        workBlockScopeKey: input.workBlockId ?? "",
      },
    },
    select: { id: true, workBlockId: true },
  });
  if (!planRun) return null;
  const receiptIdentity = {
    commandDigest: input.commandDigest,
    canonicalizer: EXECUTION_COMMAND_CANONICALIZER,
    canonicalizerVersion: EXECUTION_COMMAND_CANONICALIZER_VERSION,
  };
  const existing = await readCommandReceiptClaim(tx, planRun.id, input.commandKey);
  if (existing) return resolveExistingCommandReceipt(existing, receiptIdentity, now, { tx, leaseOwnerId, leaseExpiresAt });

  const claimed = await tx.taskPlanRun.updateMany({
    where: { id: planRun.id, executionEpoch: input.expectedEpoch },
    data: { executionEpoch: input.expectedEpoch + 1 },
  });
  if (claimed.count !== 1) {
    return readReceiptAfterLostClaim({
      tx,
      planRunId: planRun.id,
      commandKey: input.commandKey,
      ...receiptIdentity,
      now,
    });
  }

  await tx.$executeRaw`
    INSERT INTO "TaskPlanCommandReceipt" (
      "id", "planRunId", "commandKey", "commandDigest", "canonicalizer", "canonicalizerVersion",
      "status", "executionEpoch", "leaseOwnerId", "leaseExpiresAt", "claimVersion"
    ) VALUES (
      ${crypto.randomUUID()}, ${planRun.id}, ${input.commandKey}, ${input.commandDigest},
      ${EXECUTION_COMMAND_CANONICALIZER}, ${EXECUTION_COMMAND_CANONICALIZER_VERSION}, 'claimed',
      ${input.expectedEpoch + 1}, ${leaseOwnerId}, ${leaseExpiresAt}, 1
    )
  `;
  return commandClaimFromReceipt({
    planRunId: planRun.id,
    commandKey: input.commandKey,
    commandDigest: input.commandDigest,
    canonicalizer: EXECUTION_COMMAND_CANONICALIZER,
    canonicalizerVersion: EXECUTION_COMMAND_CANONICALIZER_VERSION,
    executionEpoch: input.expectedEpoch + 1,
    workBlockId: planRun.workBlockId,
    leaseOwnerId,
    leaseExpiresAt,
    claimVersion: 1,
  });
}

export async function completePlanRunCommandReceipt(input: {
  planRunId: string;
  commandKey: string;
  commandDigest: string;
  canonicalizer: string;
  canonicalizerVersion: number;
  claimedEpoch: number;
  leaseOwnerId: string;
  claimVersion: number;
  result: PlanExecutionResult;
}, tx?: Prisma.TransactionClient): Promise<boolean> {
  if (!tx) return withPlanExecutionDurability((client) => completePlanRunCommandReceipt(input, client));
  const completed = await tx.$executeRaw`
    UPDATE "TaskPlanCommandReceipt"
    SET "status" = 'completed',
        "result" = ${JSON.stringify(canonicalReceiptResult(input.result))},
        "completedAt" = ${new Date()},
        "leaseExpiresAt" = NULL
    WHERE "planRunId" = ${input.planRunId}
      AND "commandKey" = ${input.commandKey}
      AND "commandDigest" = ${input.commandDigest}
      AND "canonicalizer" = ${input.canonicalizer}
      AND "canonicalizerVersion" = ${input.canonicalizerVersion}
      AND "executionEpoch" = ${input.claimedEpoch}
      AND "leaseOwnerId" = ${input.leaseOwnerId}
      AND "claimVersion" = ${input.claimVersion}
      AND "status" = 'claimed'
      AND "result" IS NULL
  `;
  return completed === 1;
}

export async function renewPlanRunCommandReceipt(
  receipt: ClaimedPlanRunCommand,
  leaseDurationMs = COMMAND_RECEIPT_LEASE_MS,
): Promise<boolean> {
  const renewed = await withPlanExecutionDurability((tx) => tx.taskPlanCommandReceipt.updateMany({
    where: {
      planRunId: receipt.planRunId,
      commandKey: receipt.commandKey,
      commandDigest: receipt.commandDigest,
      canonicalizer: receipt.canonicalizer,
      canonicalizerVersion: receipt.canonicalizerVersion,
      executionEpoch: receipt.claimedEpoch,
      leaseOwnerId: receipt.leaseOwnerId,
      claimVersion: receipt.claimVersion,
      status: "claimed",
    },
    data: { leaseExpiresAt: new Date(Date.now() + leaseDurationMs) },
  }));
  return renewed.count === 1;
}

export async function completePlanRunCommandReceiptInTransaction(input: {
  tx: Prisma.TransactionClient;
  receipt: ClaimedPlanRunCommand;
  result: PlanExecutionResult;
}): Promise<boolean> {
  return completePlanRunCommandReceipt({
    planRunId: input.receipt.planRunId,
    commandKey: input.receipt.commandKey,
    commandDigest: input.receipt.commandDigest,
    canonicalizer: input.receipt.canonicalizer,
    canonicalizerVersion: input.receipt.canonicalizerVersion,
    claimedEpoch: input.receipt.claimedEpoch,
    leaseOwnerId: input.receipt.leaseOwnerId,
    claimVersion: input.receipt.claimVersion,
    result: input.result,
  }, input.tx);
}



export async function getPlanRun(
  taskId: string,
  planId: string,
  workBlockId?: string | null,
  tx?: Prisma.TransactionClient,
): Promise<SavedPlanRunState | null> {
  const client = tx ?? db;
  const row = await client.taskPlanRun.findUnique({
    where: {
      taskId_planId_workBlockScopeKey: {
        taskId,
        planId,
        workBlockScopeKey: workBlockId ?? "",
      },
    },
  });



  if (!row) {
    return null;
  }

  const record = row.planRun as unknown as PersistedPlanRunRecord;
  if (record.mutableGraph) {
    return {
      id: row.id,
      executionScopeId: row.executionScopeId,
      planRun: record.planRun,
      graph: record.mutableGraph.graph,
      attempts: record.mutableGraph.attempts,
      results: record.mutableGraph.results,
      executionContextSnapshots: record.mutableGraph.executionContextSnapshots,
      planOutput: record.mutableGraph.planOutput,
      executionOwnerId: row.executionOwnerId,
      executionOwnerScope: row.executionOwnerScope,
      executionLeaseUntil: row.executionLeaseUntil,
      executionEpoch: row.executionEpoch,
    };
  }

  const compiledPlan = await loadCompiledPlanForRun(taskId, planId, workBlockId, client);
  if (!compiledPlan) {
    return {
      id: row.id,
      executionScopeId: row.executionScopeId,
      planRun: record.planRun,
      graph: null,
      attempts: [],
      results: [],
      executionContextSnapshots: [],
      planOutput: createEmptyPlanOutput(),
      executionOwnerId: row.executionOwnerId,
      executionOwnerScope: row.executionOwnerScope,
      executionLeaseUntil: row.executionLeaseUntil,
      executionEpoch: row.executionEpoch,
    };
  }

  const migrated: MutablePlanRuntimeRecord = {
    graph: createPlanGraphFromCompiledPlan({ taskId, compiledPlan }) as PlanGraph,
    attempts: [],
    results: [],
    executionContextSnapshots: [],
    planOutput: createEmptyPlanOutput(),
  };


  return {
    id: row.id,
    executionScopeId: row.executionScopeId,
    planRun: record.planRun,
    graph: migrated.graph,
    attempts: migrated.attempts,
    results: migrated.results,
    executionContextSnapshots: migrated.executionContextSnapshots,
    planOutput: migrated.planOutput,
    executionOwnerId: row.executionOwnerId,
    executionOwnerScope: row.executionOwnerScope,
    executionLeaseUntil: row.executionLeaseUntil,
    executionEpoch: row.executionEpoch,
  };
}
