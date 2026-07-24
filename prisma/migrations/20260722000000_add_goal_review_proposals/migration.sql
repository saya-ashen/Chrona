-- CreateTable
CREATE TABLE "GoalReviewProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "sourceTaskId" TEXT NOT NULL,
    "sourceRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Generating',
    "inputSnapshot" JSONB NOT NULL,
    "inputSnapshotHash" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "providerName" TEXT,
    "modelName" TEXT,
    "summary" TEXT,
    "rawResult" JSONB,
    "generationError" TEXT,
    "requestIdempotencyKey" TEXT NOT NULL,
    "applicationIdempotencyKey" TEXT,
    "appliedAt" DATETIME,
    "rejectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalReviewProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalReviewProposal_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalReviewProposal_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GoalReviewProposal_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoalReviewProposalItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "dependencySnapshot" JSONB NOT NULL,
    "dependencyHash" TEXT NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'Pending',
    "decisionReason" TEXT,
    "appliedObjectType" TEXT,
    "appliedObjectId" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalReviewProposalItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalReviewProposalItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalReviewProposalItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "GoalReviewProposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GoalReviewProposal_sourceTaskId_key" ON "GoalReviewProposal"("sourceTaskId");
CREATE UNIQUE INDEX "GoalReviewProposal_sourceRunId_key" ON "GoalReviewProposal"("sourceRunId");
CREATE UNIQUE INDEX "GoalReviewProposal_goalId_requestIdempotencyKey_key" ON "GoalReviewProposal"("goalId", "requestIdempotencyKey");
CREATE INDEX "GoalReviewProposal_workspaceId_goalId_status_idx" ON "GoalReviewProposal"("workspaceId", "goalId", "status");
CREATE INDEX "GoalReviewProposal_goalId_createdAt_idx" ON "GoalReviewProposal"("goalId", "createdAt");
CREATE UNIQUE INDEX "GoalReviewProposalItem_proposalId_itemId_key" ON "GoalReviewProposalItem"("proposalId", "itemId");
CREATE INDEX "GoalReviewProposalItem_workspaceId_goalId_decision_idx" ON "GoalReviewProposalItem"("workspaceId", "goalId", "decision");
CREATE INDEX "GoalReviewProposalItem_proposalId_kind_idx" ON "GoalReviewProposalItem"("proposalId", "kind");

-- CreateTable
CREATE TABLE "GoalAssetOwnershipProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "inboxCandidateId" TEXT NOT NULL,
    "sourceTaskId" TEXT NOT NULL,
    "sourceRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Generating',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "requestIdempotencyKey" TEXT NOT NULL,
    "applicationKey" TEXT,
    "inputSnapshot" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "result" JSONB,
    "decision" TEXT,
    "targetAssetId" TEXT,
    "providerType" TEXT,
    "model" TEXT,
    "generationError" TEXT,
    "finalAction" TEXT,
    "finalAssetId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "readyAt" DATETIME,
    "appliedAt" DATETIME,
    "rejectedAt" DATETIME,
    CONSTRAINT "GoalAssetOwnershipProposal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetOwnershipProposal_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetOwnershipProposal_inboxCandidateId_fkey" FOREIGN KEY ("inboxCandidateId") REFERENCES "GoalInboxCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetOwnershipProposal_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetOwnershipProposal_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetOwnershipProposal_targetAssetId_fkey" FOREIGN KEY ("targetAssetId") REFERENCES "GoalAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GoalAssetOwnershipProposal_finalAssetId_fkey" FOREIGN KEY ("finalAssetId") REFERENCES "GoalAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GoalAssetOwnershipProposal_sourceRunId_key" ON "GoalAssetOwnershipProposal"("sourceRunId");
CREATE UNIQUE INDEX "GoalAssetOwnershipProposal_inboxCandidateId_requestIdempotencyKey_key" ON "GoalAssetOwnershipProposal"("inboxCandidateId", "requestIdempotencyKey");
CREATE INDEX "GoalAssetOwnershipProposal_workspaceId_status_updatedAt_idx" ON "GoalAssetOwnershipProposal"("workspaceId", "status", "updatedAt");
CREATE INDEX "GoalAssetOwnershipProposal_goalId_updatedAt_idx" ON "GoalAssetOwnershipProposal"("goalId", "updatedAt");
CREATE INDEX "GoalAssetOwnershipProposal_inboxCandidateId_createdAt_idx" ON "GoalAssetOwnershipProposal"("inboxCandidateId", "createdAt");
