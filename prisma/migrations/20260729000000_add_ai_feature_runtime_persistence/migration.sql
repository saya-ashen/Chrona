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

PRAGMA foreign_key_check;
