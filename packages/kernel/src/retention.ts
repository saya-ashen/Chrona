import { Prisma } from "@chrona/db";
import type { StewardPorts } from "./ports";

const HOUR_MS = 3600_000;
const HISTORY_MS = 7 * 24 * HOUR_MS;
const RECEIPT_MS = 90 * 24 * HOUR_MS;
const EXPIRED_RECEIPT = "Receipt expired after 90 days; this key remains consumed. Use a new key only for an explicitly authorized new action.";
const DELETE_BATCH = 500;
// Up to 20k rows per table per hourly pass: must outpace production writes (~22k/day per table on the live instance).
const MAX_BATCHES = 40;
const passes = new WeakMap<StewardPorts["db"], { at: number; running: boolean }>();

// An allowlist: receipts, status/health anchors, build claims, chat threading and
// unknown kinds are deliberately absent. See logs/retention-B-readers.md.
const LOG_KINDS = [
  "approval_created", "approval_resolved",
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
    AND NOT EXISTS (SELECT 1 FROM "ModuleInvocation" i WHERE i."runId" = r."id" AND ${unresolvedInvocation})`;
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

/** Keep consumed identities/digests, not unbounded request/result bodies. A missing
 * receipt would reopen an old side effect. Unknown work and pending replies never expire. */
async function expirePayloads(db: StewardPorts["db"], cutoff: Date) {
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const changed = await db.$executeRaw(Prisma.sql`UPDATE "ModuleInvocation" SET
      "args" = '{}', "chain" = '[]', "output" = NULL, "operationOutput" = NULL,
      "status" = 'failed', "errorCode" = 'conflict', "errorReason" = NULL, "error" = ${EXPIRED_RECEIPT}
      WHERE rowid IN (SELECT rowid FROM "ModuleInvocation" i WHERE
        i."status" IN ('succeeded', 'failed') AND i."requestDigest" IS NOT NULL
        AND i."targetIdentity" NOT LIKE 'system:%' AND i."targetIdentity" NOT LIKE 'local:%'
        AND i."createdAt" < ${cutoff} AND i."finishedAt" < ${cutoff}
        AND i."leaseToken" IS NULL AND i."leaseUntil" IS NULL AND (i."reply" = 0 OR i."repliedAt" IS NOT NULL)
        AND COALESCE(i."error", '') <> ${EXPIRED_RECEIPT}
        AND (i."runId" IS NULL OR EXISTS (SELECT 1 FROM "Run" r WHERE r."id" = i."runId" AND ${stoppedRun(cutoff)}))
        AND NOT EXISTS (SELECT 1 FROM "Approval" a WHERE a."status" IN ('open', 'approved')
          AND json_extract(a."payload", '$.call') = i."id")
        ORDER BY i."createdAt", i.rowid LIMIT ${DELETE_BATCH})`);
    if (changed < DELETE_BATCH) break;
  }
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const changed = await db.$executeRaw(Prisma.sql`UPDATE "Run" SET "prompt" = '', "summary" = NULL, "error" = NULL, "toolCalls" = '[]'
      WHERE rowid IN (SELECT r.rowid FROM "Run" r WHERE ${stoppedRun(cutoff)}
        AND (r."prompt" <> '' OR r."summary" IS NOT NULL OR r."error" IS NOT NULL OR r."toolCalls" <> '[]')
        ORDER BY r."createdAt", r.rowid LIMIT ${DELETE_BATCH})`);
    if (changed < DELETE_BATCH) break;
  }
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
              (SELECT 1 FROM "Run" r WHERE r."id" = i."runId" AND ${stoppedRun(cutoff)}))))))`);
    // Keyed sync/async submissions are replay receipts, not expiring diagnostics.
    // Deferred timer claims can be reused; only settled occurrences expire.
    const invocations = await deleteBatch(db, Prisma.sql`"ModuleInvocation"`, Prisma.sql`
      "mode" = 'timer'
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
    // Keep current-epoch deduplication authority. A later activation of any hash
    // retires an old epoch once its hash is inactive, or a same-hash successor exists.
    const results = await deleteBatch(db, Prisma.sql`"ModuleExecutionResult"`, Prisma.sql`
      "createdAt" < ${cutoff} AND "outcome" IN ('success', 'failure') AND EXISTS
      (SELECT 1 FROM "ModuleActivation" old WHERE old."activationId" = "ModuleExecutionResult"."activationId"
        AND old."moduleId" = "ModuleExecutionResult"."moduleId" AND old."candidateHash" = "ModuleExecutionResult"."hash"
        AND EXISTS (SELECT 1 FROM "ModuleActivation" newer WHERE newer."moduleId" = old."moduleId"
          AND (newer."candidateHash" = old."candidateHash" OR EXISTS
            (SELECT 1 FROM "Module" m WHERE m."id" = old."moduleId" AND m."activeHash" IS NOT old."candidateHash"))
          AND (newer."createdAt" > old."createdAt"
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
    await expirePayloads(db, new Date(at - RECEIPT_MS));
    const audit = await deleteBatch(db, Prisma.sql`"Audit"`, Prisma.sql`"createdAt" < ${cutoff} AND "kind" IN (${Prisma.join(LOG_KINDS)})`);
    return { calls, invocations, runs, results, events, facts, audit };
  } finally { pass.running = false; }
}
