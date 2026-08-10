-- Runtime-owned AI feature invocations are intentionally distinct from Task execution Run.
CREATE TABLE "AiFeatureRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "featureId" TEXT NOT NULL,
  "featureVersion" INTEGER NOT NULL,
  "manifest" JSONB NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "operationKind" TEXT NOT NULL,
  "retryOfRunId" TEXT,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "subjectRevision" TEXT,
  "status" TEXT NOT NULL,
  "stateVersion" INTEGER NOT NULL DEFAULT 0,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT,
  "leaseExpiresAt" DATETIME,
  "heartbeatAt" DATETIME,
  "objective" JSONB NOT NULL,
  "input" JSONB NOT NULL,
  "inputHash" TEXT NOT NULL,
  "providerClientId" TEXT,
  "providerName" TEXT,
  "providerModelName" TEXT,
  "providerConfigFingerprint" TEXT,
  "providerRunRef" TEXT,
  "providerResumeRef" TEXT,
  "terminalCandidate" JSONB,
  "terminalResult" JSONB,
  "proposedActions" JSONB,
  "completionReport" JSONB,
  "commitStatus" TEXT,
  "commitReference" JSONB,
  "committedAt" DATETIME,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AiFeatureRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiFeatureRun_providerClientId_fkey" FOREIGN KEY ("providerClientId") REFERENCES "AiClient" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AiFeatureRun_retryOfRunId_fkey" FOREIGN KEY ("retryOfRunId") REFERENCES "AiFeatureRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiFeatureRun_workspaceId_featureId_subjectType_subjectId_operationKind_operationId_key"
  ON "AiFeatureRun" ("workspaceId", "featureId", "subjectType", "subjectId", "operationKind", "operationId");
CREATE INDEX "AiFeatureRun_workspaceId_subjectType_subjectId_createdAt_idx"
  ON "AiFeatureRun" ("workspaceId", "subjectType", "subjectId", "createdAt");
CREATE INDEX "AiFeatureRun_featureId_status_createdAt_idx"
  ON "AiFeatureRun" ("featureId", "status", "createdAt");

CREATE TABLE "AiFeatureRunObservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "observationId" TEXT NOT NULL,
  "observationType" TEXT NOT NULL,
  "observationVersion" INTEGER NOT NULL,
  "observationKey" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "delivery" TEXT NOT NULL,
  "canonicalizerId" TEXT NOT NULL,
  "hashAlgorithm" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "observedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiFeatureRunObservation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiFeatureRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AiFeatureRunObservation_runId_sequence_key"
  ON "AiFeatureRunObservation" ("runId", "sequence");
CREATE UNIQUE INDEX "AiFeatureRunObservation_runId_observationId_key"
  ON "AiFeatureRunObservation" ("runId", "observationId");
CREATE UNIQUE INDEX "AiFeatureRunObservation_runId_observationType_observationVersion_observationKey_revision_key"
  ON "AiFeatureRunObservation" ("runId", "observationType", "observationVersion", "observationKey", "revision");
CREATE INDEX "AiFeatureRunObservation_runId_observationType_observationKey_idx"
  ON "AiFeatureRunObservation" ("runId", "observationType", "observationKey");

CREATE TABLE "AiFeatureRunAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "callId" TEXT NOT NULL,
  "executionKey" TEXT NOT NULL,
  "actionId" TEXT NOT NULL,
  "actionVersion" INTEGER NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" TEXT,
  "leaseExpiresAt" DATETIME,
  "input" JSONB NOT NULL,
  "inputHash" TEXT NOT NULL,
  "outputObservationId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" DATETIME,
  CONSTRAINT "AiFeatureRunAction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiFeatureRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiFeatureRunAction_runId_outputObservationId_fkey" FOREIGN KEY ("runId", "outputObservationId") REFERENCES "AiFeatureRunObservation" ("runId", "observationId") ON UPDATE CASCADE

);
CREATE UNIQUE INDEX "AiFeatureRunAction_executionKey_key" ON "AiFeatureRunAction" ("executionKey");
CREATE UNIQUE INDEX "AiFeatureRunAction_runId_mode_callId_key" ON "AiFeatureRunAction" ("runId", "mode", "callId");
CREATE INDEX "AiFeatureRunAction_runId_actionId_status_idx" ON "AiFeatureRunAction" ("runId", "actionId", "status");

-- Nullable additions retain every legacy plan/proposal without fabricating runtime provenance.
ALTER TABLE "TaskPlan" ADD COLUMN "aiFeatureRunId" TEXT REFERENCES "AiFeatureRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "TaskPlan_aiFeatureRunId_key" ON "TaskPlan" ("aiFeatureRunId");

ALTER TABLE "GoalReviewProposal" ADD COLUMN "aiFeatureRunId" TEXT REFERENCES "AiFeatureRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoalReviewProposal" ADD COLUMN "stateVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GoalReviewProposal" ADD COLUMN "questions" JSONB;
ALTER TABLE "GoalReviewProposal" ADD COLUMN "partialOutput" JSONB;
ALTER TABLE "GoalReviewProposal" ADD COLUMN "cannotCompleteReason" TEXT;
ALTER TABLE "GoalReviewProposal" ADD COLUMN "missingObservations" JSONB;
CREATE UNIQUE INDEX "GoalReviewProposal_aiFeatureRunId_key" ON "GoalReviewProposal" ("aiFeatureRunId");

CREATE TABLE "TaskPlanGenerationHead" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "workBlockScopeKey" TEXT NOT NULL,
  "baselinePlanId" TEXT,
  "baselinePlanRevision" INTEGER,
  "baselinePlanStatus" TEXT,

  "baselinePlanContentHash" TEXT,
  "baselineHash" TEXT,

  "currentPlanId" TEXT,
  "currentPlanRevision" INTEGER,
  "currentPlanContentHash" TEXT,
  "currentPlanStatus" TEXT,
  "generationVersion" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'Idle',
  "currentAiFeatureRunId" TEXT,

  "stateVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TaskPlanGenerationHead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanGenerationHead_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanGenerationHead_baselinePlanId_fkey" FOREIGN KEY ("baselinePlanId") REFERENCES "TaskPlan" ("planId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanGenerationHead_currentPlanId_fkey" FOREIGN KEY ("currentPlanId") REFERENCES "TaskPlan" ("planId") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanGenerationHead_currentAiFeatureRunId_fkey" FOREIGN KEY ("currentAiFeatureRunId") REFERENCES "AiFeatureRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TaskPlanGenerationHead_taskId_workBlockScopeKey_key"
  ON "TaskPlanGenerationHead" ("taskId", "workBlockScopeKey");
CREATE INDEX "TaskPlanGenerationHead_workspaceId_taskId_idx"
  ON "TaskPlanGenerationHead" ("workspaceId", "taskId");
CREATE INDEX "TaskPlanGenerationHead_baselinePlanId_idx"
  ON "TaskPlanGenerationHead" ("baselinePlanId");
CREATE INDEX "TaskPlanGenerationHead_currentPlanId_idx"
  ON "TaskPlanGenerationHead" ("currentPlanId");
CREATE UNIQUE INDEX "TaskPlanGenerationHead_currentAiFeatureRunId_key"
  ON "TaskPlanGenerationHead" ("currentAiFeatureRunId");


-- Existing plans have no canonical content hash. Preserve a NULL snapshot rather
-- than fabricate one; the next CAS writer records a canonical hash. Scope derives
-- from a real workBlockId, with the explicit empty key for the unscoped case.
INSERT INTO "TaskPlanGenerationHead" (
  "id", "workspaceId", "taskId", "workBlockScopeKey",
  "baselinePlanId", "baselinePlanRevision", "baselinePlanStatus", "baselineHash", "currentPlanId", "currentPlanRevision", "currentPlanStatus",
  "generationVersion", "status", "stateVersion", "createdAt", "updatedAt"
)
SELECT
  'task-plan-generation-head:' || "planId",
  "workspaceId",
  "taskId",
  COALESCE("workBlockId", ''),
  "planId",
  "revision",
  "status",
  NULL,
  "planId",
  "revision",
  "status",
  0,
  'Current',
  0,
  "createdAt",
  "updatedAt"
FROM (
  SELECT
    "planId", "workspaceId", "taskId", "workBlockId", "revision", "status", "createdAt", "updatedAt",
    ROW_NUMBER() OVER (
      PARTITION BY "taskId", COALESCE("workBlockId", '')
      ORDER BY "updatedAt" DESC, "createdAt" DESC
    ) AS "rowNumber"
  FROM "TaskPlan"
)
WHERE "rowNumber" = 1;


-- Migrate recurrence ownership to durable schedule triggers and one versioned key format.
INSERT INTO "TaskTrigger" (
  "id", "workspaceId", "taskId", "kind", "state", "config", "version", "createdAt", "updatedAt"
)
SELECT
  lower(hex(randomblob(16))),
  t."workspaceId",
  t."id",
  'schedule',
  'Enabled',
  json_patch(
    json_object(
      'mode', 'recurring',
      'rrule', t."recurrenceRule",
      'anchorStartAt', CASE
        WHEN typeof(t."recurrenceAnchorStartAt") IN ('integer', 'real')
          THEN strftime('%Y-%m-%dT%H:%M:%fZ', t."recurrenceAnchorStartAt" / 1000.0, 'unixepoch')
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', t."recurrenceAnchorStartAt")
      END,
      'timezone', 'UTC',
      'durationMs', CASE
        WHEN typeof(t."recurrenceAnchorStartAt") IN ('integer', 'real')
          THEN CAST(t."recurrenceAnchorEndAt" - t."recurrenceAnchorStartAt" AS INTEGER)
        ELSE CAST((julianday(t."recurrenceAnchorEndAt") - julianday(t."recurrenceAnchorStartAt")) * 86400000 AS INTEGER)
      END
    ),
    CASE WHEN t."recurrenceWindowUntil" IS NULL THEN json_object() ELSE json_object(
      'windowUntil', CASE
        WHEN typeof(t."recurrenceWindowUntil") IN ('integer', 'real')
          THEN strftime('%Y-%m-%dT%H:%M:%fZ', t."recurrenceWindowUntil" / 1000.0, 'unixepoch')
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', t."recurrenceWindowUntil")
      END
    ) END
  ),
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Task" t
WHERE t."recurrenceRule" IS NOT NULL
  AND t."recurrenceAnchorStartAt" IS NOT NULL
  AND t."recurrenceAnchorEndAt" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "TaskTrigger" tt WHERE tt."taskId" = t."id" AND tt."kind" = 'schedule'
  );

-- Legacy updateTask materialized bare ISO recurrence keys without TaskOccurrence rows.
-- Bind those blocks to the exact schedule-trigger version before normalizing their keys.
WITH "legacyRecurrenceBlocks" AS (
  SELECT
    wb."id" AS "workBlockId",
    wb."workspaceId",
    wb."taskId",
    wb."recurrenceKey",
    wb."status" AS "workBlockStatus",
    wb."scheduledStartAt",
    wb."startedAt",
    wb."completedAt",
    tt."id" AS "triggerId",
    tt."version" AS "triggerVersion",
    CASE
      WHEN typeof(wb."scheduledStartAt") IN ('integer', 'real')
        THEN strftime('%Y-%m-%dT%H:%M:%fZ', wb."scheduledStartAt" / 1000.0, 'unixepoch')
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', wb."scheduledStartAt")
    END AS "normalizedStartAt"
  FROM "WorkBlock" wb
  JOIN "Task" t ON t."id" = wb."taskId"
  JOIN "TaskTrigger" tt ON tt."taskId" = wb."taskId" AND tt."kind" = 'schedule'
  WHERE t."recurrenceRule" IS NOT NULL
    AND wb."recurrenceKey" IS NOT NULL
    AND wb."recurrenceKey" NOT LIKE 'schedule:v%:%'
    AND NOT EXISTS (
      SELECT 1 FROM "TaskOccurrence" existing WHERE existing."workBlockId" = wb."id"
    )
)
INSERT INTO "TaskOccurrence" (
  "id", "workspaceId", "taskId", "triggerId", "workBlockId",
  "occurrenceKey", "triggerVersion", "source", "status", "eligibleAt",
  "startedAt", "completedAt", "executionEpoch"
)
SELECT
  'legacy-schedule-occurrence:' || legacy."workBlockId",
  legacy."workspaceId",
  legacy."taskId",
  legacy."triggerId",
  legacy."workBlockId",
  'schedule:v' || legacy."triggerVersion" || ':' || legacy."normalizedStartAt",
  legacy."triggerVersion",
  json_object('kind', 'trigger', 'triggerId', legacy."triggerId", 'migration', 'legacy_recurrence_block'),
  CASE legacy."workBlockStatus"
    WHEN 'Active' THEN 'Running'
    WHEN 'Completed' THEN 'Completed'
    WHEN 'Cancelled' THEN 'Cancelled'
    WHEN 'Blocked' THEN 'Blocked'
    WHEN 'Failed' THEN 'Failed'
    WHEN 'Ready' THEN 'Ready'
    ELSE CASE WHEN julianday(legacy."scheduledStartAt") > julianday(CURRENT_TIMESTAMP) THEN 'Scheduled' ELSE 'Ready' END
  END,
  legacy."scheduledStartAt",
  legacy."startedAt",
  legacy."completedAt",
  1
FROM "legacyRecurrenceBlocks" legacy
WHERE legacy."normalizedStartAt" IS NOT NULL
  AND legacy."recurrenceKey" = legacy."normalizedStartAt";

UPDATE "WorkBlock"
SET "recurrenceKey" = (
  SELECT o."occurrenceKey" FROM "TaskOccurrence" o WHERE o."workBlockId" = "WorkBlock"."id"
)
WHERE EXISTS (
  SELECT 1 FROM "TaskOccurrence" o
  WHERE o."workBlockId" = "WorkBlock"."id" AND o."occurrenceKey" <> "WorkBlock"."recurrenceKey"
);


-- Make provider-event scope durable and keep latest pointers monotonic.
ALTER TABLE "RawEventLog" ADD COLUMN "workBlockId" TEXT REFERENCES "WorkBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RawEventLog" ADD COLUMN "occurrenceId" TEXT REFERENCES "TaskOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Event" ADD COLUMN "occurrenceId" TEXT REFERENCES "TaskOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Event_occurrenceId_ingestSequence_idx" ON "Event"("occurrenceId", "ingestSequence");
ALTER TABLE "Task" ADD COLUMN "latestEventSequence" INTEGER;
ALTER TABLE "TaskPlanRun" ADD COLUMN "latestEventSequence" INTEGER;
ALTER TABLE "TaskPlanRun" ADD COLUMN "executionScopeId" TEXT;
UPDATE "TaskPlanRun" SET "executionScopeId" = 'ES' || lower(hex(randomblob(16))) WHERE "executionScopeId" IS NULL;
CREATE UNIQUE INDEX "TaskPlanRun_executionScopeId_key" ON "TaskPlanRun"("executionScopeId");
ALTER TABLE "WorkBlock" ADD COLUMN "latestEventId" TEXT;
ALTER TABLE "WorkBlock" ADD COLUMN "latestRawEventId" TEXT;
ALTER TABLE "WorkBlock" ADD COLUMN "latestEventSequence" INTEGER;

CREATE TABLE "EventIngestSequence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "value" INTEGER NOT NULL,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "RawEventLog_workBlockId_receivedAt_idx" ON "RawEventLog"("workBlockId", "receivedAt");
CREATE INDEX "RawEventLog_occurrenceId_receivedAt_idx" ON "RawEventLog"("occurrenceId", "receivedAt");

-- Fence task-orchestrator ownership across lease takeovers.
ALTER TABLE "SchedulerLease" ADD COLUMN "epoch" INTEGER NOT NULL DEFAULT 1;


-- Preserve command replay identity beyond the most recently claimed command.
CREATE TABLE "TaskPlanCommandReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "planRunId" TEXT NOT NULL,
  "commandKey" TEXT NOT NULL,
  "commandDigest" TEXT NOT NULL,
  "canonicalizer" TEXT NOT NULL,
  "canonicalizerVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'claimed',
  "result" JSONB,
  "executionEpoch" INTEGER NOT NULL,
  "leaseOwnerId" TEXT,
  "leaseExpiresAt" DATETIME,
  "claimVersion" INTEGER NOT NULL DEFAULT 1,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskPlanCommandReceipt_planRunId_fkey" FOREIGN KEY ("planRunId") REFERENCES "TaskPlanRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TaskPlanCommandReceipt_planRunId_commandKey_key" ON "TaskPlanCommandReceipt"("planRunId", "commandKey");
CREATE INDEX "TaskPlanCommandReceipt_planRunId_executionEpoch_idx" ON "TaskPlanCommandReceipt"("planRunId", "executionEpoch");
CREATE INDEX "TaskPlanCommandReceipt_planRunId_commandDigest_idx" ON "TaskPlanCommandReceipt"("planRunId", "commandDigest");
CREATE INDEX "TaskPlanCommandReceipt_planRunId_status_idx" ON "TaskPlanCommandReceipt"("planRunId", "status");
CREATE INDEX "TaskPlanCommandReceipt_planRunId_status_leaseExpiresAt_idx" ON "TaskPlanCommandReceipt"("planRunId", "status", "leaseExpiresAt");

-- Durable provider approval resolution claims keep human decisions replayable without exposing runtime refs publicly.
CREATE TABLE "TaskPlanProviderApprovalResolution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "approvalId" TEXT NOT NULL,
  "activeClaimKey" TEXT,
  "providerRunId" TEXT NOT NULL,
  "nodeAttemptId" TEXT NOT NULL,
  "planRunId" TEXT NOT NULL,
  "resolutionKey" TEXT NOT NULL,
  "resolutionDigest" TEXT NOT NULL,
  "canonicalizer" TEXT NOT NULL,
  "canonicalizerVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'claimed',
  "leaseOwner" TEXT,
  "leaseExpiresAt" DATETIME,
  "canonicalResult" JSONB,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TaskPlanProviderApprovalResolution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanProviderApprovalResolution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanProviderApprovalResolution_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "TaskPlanProviderApproval" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanProviderApprovalResolution_providerRunId_fkey" FOREIGN KEY ("providerRunId") REFERENCES "TaskPlanProviderRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanProviderApprovalResolution_nodeAttemptId_fkey" FOREIGN KEY ("nodeAttemptId") REFERENCES "TaskPlanNodeAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaskPlanProviderApprovalResolution_planRunId_fkey" FOREIGN KEY ("planRunId") REFERENCES "TaskPlanRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TaskPlanProviderApprovalResolution_planRunId_approvalId_resolutionKey_key"
  ON "TaskPlanProviderApprovalResolution"("planRunId", "approvalId", "resolutionKey");
CREATE UNIQUE INDEX "TaskPlanProviderApprovalResolution_activeClaimKey_key"
  ON "TaskPlanProviderApprovalResolution"("activeClaimKey");
CREATE INDEX "TaskPlanProviderApprovalResolution_approvalId_status_idx"
  ON "TaskPlanProviderApprovalResolution"("approvalId", "status");
CREATE INDEX "TaskPlanProviderApprovalResolution_planRunId_resolutionDigest_idx"
  ON "TaskPlanProviderApprovalResolution"("planRunId", "resolutionDigest");
CREATE INDEX "TaskPlanProviderApprovalResolution_providerRunId_status_idx"
  ON "TaskPlanProviderApprovalResolution"("providerRunId", "status");

-- Bind provider audit state to the exact canonical runtime Run. Historical rows
-- are backfilled only when both sides are unambiguous; ambiguous legacy rows
-- remain unbound and recovery fails closed.
ALTER TABLE "TaskPlanProviderRun" ADD COLUMN "aiClientId" TEXT;
ALTER TABLE "TaskPlanProviderRun" ADD COLUMN "aiClientConfigDigest" TEXT;
CREATE INDEX "TaskPlanProviderRun_aiClientId_idx" ON "TaskPlanProviderRun"("aiClientId");

ALTER TABLE "TaskPlanProviderRun" ADD COLUMN "runId" TEXT REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
UPDATE "TaskPlanProviderRun" AS "providerRun"
SET "runId" = (
  SELECT "run"."id"
  FROM "Run" AS "run"
  WHERE "run"."taskId" = "providerRun"."taskId"
    AND "run"."runtimeRunRef" = "providerRun"."providerRunRef"
)
WHERE "providerRun"."providerRunRef" IS NOT NULL
  AND 1 = (
    SELECT COUNT(*) FROM "Run" AS "run"
    WHERE "run"."taskId" = "providerRun"."taskId"
      AND "run"."runtimeRunRef" = "providerRun"."providerRunRef"
  )
  AND 1 = (
    SELECT COUNT(*) FROM "TaskPlanProviderRun" AS "peer"
    WHERE "peer"."taskId" = "providerRun"."taskId"
      AND "peer"."providerRunRef" = "providerRun"."providerRunRef"
  );
CREATE INDEX "TaskPlanProviderRun_runId_idx" ON "TaskPlanProviderRun"("runId");

-- Bind every new canonical runtime Run directly to its immutable node attempt.
-- Historical rows are backfilled only through an already exact ProviderRun FK.
ALTER TABLE "Run" ADD COLUMN "nodeAttemptId" TEXT REFERENCES "TaskPlanNodeAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
UPDATE "Run" AS "run"
SET "nodeAttemptId" = (
  SELECT "providerRun"."nodeAttemptId"
  FROM "TaskPlanProviderRun" AS "providerRun"
  WHERE "providerRun"."runId" = "run"."id"
)
WHERE 1 = (
  SELECT COUNT(*) FROM "TaskPlanProviderRun" AS "providerRun"
  WHERE "providerRun"."runId" = "run"."id"
)
AND 1 = (
  SELECT COUNT(DISTINCT "peer"."runId")
  FROM "TaskPlanProviderRun" AS "peer"
  WHERE "peer"."nodeAttemptId" = (
    SELECT "providerRun"."nodeAttemptId"
    FROM "TaskPlanProviderRun" AS "providerRun"
    WHERE "providerRun"."runId" = "run"."id"
  )
    AND "peer"."runId" IS NOT NULL
);
CREATE UNIQUE INDEX "Run_nodeAttemptId_key" ON "Run"("nodeAttemptId");

-- Bind provider control callbacks to the exact durable provider run.
ALTER TABLE "RunToken" ADD COLUMN "providerRunId" TEXT;
CREATE INDEX "RunToken_providerRunId_idx" ON "RunToken"("providerRunId");

ALTER TABLE "TaskPlanRun" DROP COLUMN "executionCommandKey";