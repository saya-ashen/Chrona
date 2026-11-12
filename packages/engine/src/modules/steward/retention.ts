import { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";

const HOUR_MS = 3600_000;
const HISTORY_MS = 7 * 24 * HOUR_MS;
const DELETE_BATCH = 500;
// Up to 20k rows per table per hourly pass: must outpace production writes (~22k/day per table on the live instance).
const MAX_BATCHES = 40;
// Reads replay harmlessly, so their rows are never receipts, keyed or not (legacy rows predate keyless omission).
const READ_TOOLS = [
  "modules.list", "modules.describe", "modules.health", "modules.receipt", "agent.read", "agent.providers",
  "runtime-callback.event", "pi.health", "pi.transcript",
];
const passes = new WeakMap<StewardPorts["db"], { at: number; running: boolean }>();

// An allowlist: receipts, status/health anchors, build claims, chat threading and
// unknown kinds are deliberately absent. See logs/retention-B-readers.md.
const LOG_KINDS = [
  "module_execution_result", "module_evolution_outcome", "approval_created", "approval_resolved",
  "grant_created", "grant_revoked", "grant_consumed", "secret_set", "secret_removed", "settings_updated",
  "module_activate", "module_auto_activated", "module_rollback", "module_migration_started",
  "module_submission", "module_build_settled", "module_build_rejection", "admin_rollback",
  "reflection_started", "reflection_suggested", "module_settings_updated",
  "workspace_stray_quarantined", "workspace_stray_quarantine_failed", "build_settings_updated",
  "module_build_failed", "module_model_call", "module_tool_call", "module_status_changed", "module_removed",
  "module_group_activation", "module_candidate_rejected", "build_targets", "build_request",
  "run_claimed", "run_finished", "run_reply", "tool_limit_rejected", "tool_started", "tool_finished",
  "run_finalize_failed", "execution_capture_failed",
];

const unresolvedInvocation = Prisma.sql`(i."status" NOT IN ('succeeded', 'failed')
  OR i."leaseToken" IS NOT NULL OR i."leaseUntil" IS NOT NULL
  OR (i."reply" = 1 AND i."repliedAt" IS NULL))`;

/** Alias r. endedAt alone is not stop evidence. Pending outbound receipts still
 * hold history even after the execution's final result has settled. */
function stoppedRun(cutoff: Date) {
  return Prisma.sql`r."status" IN ('finished', 'failed', 'cancelled', 'timed_out', 'provider_unavailable')
    AND r."stopStatus" = 'confirmed' AND r."endedAt" < ${cutoff} AND r."leaseUntil" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "ModuleInvocation" i WHERE i."runId" = r."id" AND ${unresolvedInvocation})
    AND NOT EXISTS (SELECT 1 FROM "ExecutionAttempt" a WHERE a."runId" = r."id" AND
      (a."stopConfirmedAt" IS NULL OR EXISTS (SELECT 1 FROM "ExecutionDelivery" d WHERE d."attemptId" = a."id" AND
        (d."settledAt" IS NULL OR EXISTS (SELECT 1 FROM "ExecutionReceipt" q WHERE q."deliveryId" = d."id"
          AND q."direction" = 'outbound' AND q."acceptedAt" IS NULL)))))`;
}

/** One atomic selection+delete, never an unbounded OR list of IDs. Every caller
 * supplies a closed table identifier; SQLite evaluates the live guards in the
 * same write statement as LIMIT, avoiding a select/delete race. */
async function deleteBatch(db: StewardPorts["db"], table: Prisma.Sql, predicate: Prisma.Sql) {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const deleted = await db.$executeRaw(Prisma.sql`DELETE FROM ${table} WHERE rowid IN
      (SELECT rowid FROM ${table} WHERE ${predicate} ORDER BY "createdAt", rowid LIMIT ${DELETE_BATCH})`);
    total += deleted;
    if (deleted < DELETE_BATCH) break;
  }
  return total;
}

/** Shared by tick instances using this client. Reserve before awaiting so overlap,
 * failure, and backwards clocks cannot cause a tight retry loop. Each hourly pass
 * drains every table in 500-row batches, at most MAX_BATCHES per table. */
export async function pruneHistory(db: StewardPorts["db"], now: Date) {
  const prior = passes.get(db), at = now.getTime();
  if (prior && (prior.running || at - prior.at < HOUR_MS)) return null;
  const pass = { at, running: true };
  passes.set(db, pass);
  const cutoff = new Date(at - HISTORY_MS);
  try {
    // Nonrejected model reservations have unbounded replay/per-event accounting
    // readers. Keep them, including completed reservations and removed owners.
    const calls = await deleteBatch(db, Prisma.sql`"ModuleCall"`, Prisma.sql`
      "createdAt" < ${cutoff} AND ("status" = 'rejected' OR
        ("method" <> 'model' AND "status" IN ('executed', 'failed') AND COALESCE("error", '') NOT IN ('unknown', 'internal')))
      AND NOT EXISTS (SELECT 1 FROM "AgentRunProvider" p WHERE json_extract(p."completion", '$.reservationId') = "ModuleCall"."id")
      AND NOT EXISTS (SELECT 1 FROM "ModuleRun" m WHERE m."id" = "ModuleCall"."moduleRunId" AND
        (m."exitCode" < 0 OR m."createdAt" >= ${cutoff} OR EXISTS
          (SELECT 1 FROM "ModuleInvocation" i WHERE i."id" = m."triggerId" AND
            (${unresolvedInvocation} OR (i."runId" IS NOT NULL AND NOT EXISTS
              (SELECT 1 FROM "Run" r WHERE r."id" = i."runId" AND ${stoppedRun(cutoff)}))))))
      AND ("eventKey" IS NULL OR "eventKey" NOT LIKE 'execution:%' OR EXISTS
        (SELECT 1 FROM "ExecutionAttempt" a JOIN "Run" r ON r."id" = a."runId"
          WHERE 'execution:' || a."id" = "ModuleCall"."eventKey" AND ${stoppedRun(cutoff)}))`);
    // Keyed sync/async submissions are replay receipts, not expiring diagnostics.
    // Deferred timer claims can be reused; only settled occurrences expire.
    const invocations = await deleteBatch(db, Prisma.sql`"ModuleInvocation"`, Prisma.sql`
      ("mode" IN ('timer', 'schedule') OR ("mode" = 'sync' AND "target" || '.' || "tool" IN (${Prisma.join(READ_TOOLS)})))
      AND "status" IN ('succeeded', 'failed')
      AND "createdAt" < ${cutoff} AND "finishedAt" < ${cutoff}
      AND "leaseToken" IS NULL AND "leaseUntil" IS NULL AND ("reply" = 0 OR "repliedAt" IS NOT NULL)
      AND ("runId" IS NULL OR EXISTS (SELECT 1 FROM "Run" r WHERE r."id" = "ModuleInvocation"."runId" AND ${stoppedRun(cutoff)}))`);
    // -1 is used both before execution and for uncertain/failed delivery. There
    // is no finishedAt on ModuleRun, so it is never an age-only candidate.
    const runs = await deleteBatch(db, Prisma.sql`"ModuleRun"`, Prisma.sql`
      "createdAt" < ${cutoff} AND "firedAt" < ${cutoff} AND "exitCode" >= 0
      AND NOT EXISTS (SELECT 1 FROM "ModuleInvocation" i WHERE i."id" = "ModuleRun"."triggerId" AND
        (${unresolvedInvocation} OR (i."runId" IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM "Run" r WHERE r."id" = i."runId" AND ${stoppedRun(cutoff)}))))
      AND NOT EXISTS (SELECT 1 FROM "ModuleCall" c WHERE c."moduleRunId" = "ModuleRun"."id"
        AND c."status" IN ('pending', 'queued', 'running', 'waiting', 'unknown'))`);
    // All receipts in the newest epoch of each hash are still deduplication
    // authority. Old epochs cannot re-enter policy, even after same-hash resume.
    const results = await deleteBatch(db, Prisma.sql`"ModuleExecutionResult"`, Prisma.sql`
      "createdAt" < ${cutoff} AND "outcome" IN ('success', 'failure') AND EXISTS
      (SELECT 1 FROM "ModuleActivation" old WHERE old."activationId" = "ModuleExecutionResult"."activationId"
        AND old."moduleId" = "ModuleExecutionResult"."moduleId" AND old."candidateHash" = "ModuleExecutionResult"."hash"
        AND EXISTS (SELECT 1 FROM "ModuleActivation" newer WHERE newer."moduleId" = old."moduleId"
          AND newer."candidateHash" = old."candidateHash" AND (newer."createdAt" > old."createdAt"
            OR (newer."createdAt" = old."createdAt" AND newer."activationId" > old."activationId"))))`);
    const events = await deleteBatch(db, Prisma.sql`"RunEvent"`, Prisma.sql`
      "createdAt" < ${cutoff} AND EXISTS (SELECT 1 FROM "Run" r WHERE r."id" = "RunEvent"."runId" AND ${stoppedRun(cutoff)})
      AND NOT ("kind" = 'completion' AND EXISTS (SELECT 1 FROM "AgentRunProvider" p
        WHERE p."runId" = "RunEvent"."runId" AND p."kind" = 'completion'))`);
    // An existing consumer may retry a staged ACK after an indefinite pause.
    // Removal closes that caller identity. Withdrawals remain cross-consumer
    // tombstones even when their original consumer has been removed.
    const facts = await deleteBatch(db, Prisma.sql`"KernelFact"`, Prisma.sql`
      "createdAt" < ${cutoff} AND "consumedAt" < ${cutoff} AND "consumedBy" IS NOT NULL
      AND json_extract("payload", '$.type') IN ('notice', 'lifecycle', 'approval')
      AND NOT EXISTS (SELECT 1 FROM "Module" m WHERE m."id" = "KernelFact"."consumedBy")
      AND NOT EXISTS (SELECT 1 FROM "KernelFactConsumer" c WHERE c."workspaceId" = "KernelFact"."workspaceId"
        AND c."moduleId" = "KernelFact"."consumedBy")`);
    const audit = await deleteBatch(db, Prisma.sql`"Audit"`, Prisma.sql`"createdAt" < ${cutoff} AND "kind" IN (${Prisma.join(LOG_KINDS)})`);
    return { calls, invocations, runs, results, events, facts, audit };
  } finally { pass.running = false; }
}
