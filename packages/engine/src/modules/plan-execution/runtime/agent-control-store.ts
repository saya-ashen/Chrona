import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { AgentControlActionKind } from "@chrona/contracts/api";

const TOKEN_BYTES = 32;
const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;
const MIN_TOKEN_TTL_MS = 60 * 1000;
const MAX_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export type RunTokenScope = {
  token: string;
  taskId: string;
  workspaceId: string;
  taskSessionId: string | null;
  runId: string;
  runtimeSessionKey: string;
  nodeId: string | null;
  providerRunId: string | null;
  nodeAttemptId: string | null;
};

export type RecordedTerminalAction = {
  id: string;
  taskId: string;
  runId: string;
  taskSessionId: string | null;
  runtimeSessionKey: string;
  nodeId: string | null;
  nodeAttemptId: string | null;
  kind: AgentControlActionKind;
  payload: unknown;
  recordedAt: Date;
};

export class ConflictingTerminalActionError extends Error {
  readonly code = "conflicting_terminal_action";
  constructor(
    public readonly existingKind: AgentControlActionKind,
    public readonly requestedKind: AgentControlActionKind,
  ) {
    super(`Terminal action '${existingKind}' was already recorded for this node attempt; cannot record '${requestedKind}'`);
    this.name = "ConflictingTerminalActionError";
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokenTtlMs() {
  const configured = Number.parseInt(process.env.CHRONA_RUN_TOKEN_TTL_MS ?? "", 10);
  if (!Number.isSafeInteger(configured)) return DEFAULT_TOKEN_TTL_MS;
  return Math.min(Math.max(configured, MIN_TOKEN_TTL_MS), MAX_TOKEN_TTL_MS);
}

export async function mintRunToken(input: {
  taskId: string;
  workspaceId: string;
  taskSessionId?: string | null;
  runId: string;
  runtimeSessionKey: string;
  nodeId?: string | null;
  providerRunId?: string | null;
  nodeAttemptId?: string | null;
  expiresAt?: Date;
}): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await db.runToken.create({
    data: {
      tokenHash: hashToken(token),
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      taskSessionId: input.taskSessionId ?? null,
      runId: input.runId,
      runtimeSessionKey: input.runtimeSessionKey,
      nodeId: input.nodeId ?? null,
      nodeAttemptId: input.nodeAttemptId ?? null,
      providerRunId: input.providerRunId ?? null,
      expiresAt: input.expiresAt ?? new Date(Date.now() + tokenTtlMs()),
    },
  });
  return token;
}

export async function validateRunToken(token: string): Promise<RunTokenScope | null> {
  const tokenHash = hashToken(token);
  const match = await db.runToken.findUnique({
    where: { tokenHash },
    select: {
      taskId: true,
      workspaceId: true,
      taskSessionId: true,
      runId: true,
      runtimeSessionKey: true,
      nodeId: true,
      nodeAttemptId: true,
      providerRunId: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (
    !match
    || match.revokedAt
    || match.expiresAt <= new Date()
    || !match.taskId
    || !match.workspaceId
    || !match.runId
    || !match.runtimeSessionKey
  ) return null;
  return {
    token,
    taskId: match.taskId,
    workspaceId: match.workspaceId,
    taskSessionId: match.taskSessionId,
    runId: match.runId,
    runtimeSessionKey: match.runtimeSessionKey,
    nodeId: match.nodeId,
    nodeAttemptId: match.nodeAttemptId,
    providerRunId: match.providerRunId,
  };
}

/**
 * Returns a still-live token's scope only after it has been revoked.
 *
 * This is intentionally narrower than validateRunToken: callers may use it
 * only to acknowledge an already-persisted terminal action, never to start
 * new work with a revoked credential.
 */
export async function validateRevokedRunToken(token: string): Promise<RunTokenScope | null> {
  const tokenHash = hashToken(token);
  const match = await db.runToken.findUnique({
    where: { tokenHash },
    select: {
      taskId: true,
      workspaceId: true,
      taskSessionId: true,
      runId: true,
      runtimeSessionKey: true,
      nodeId: true,
      nodeAttemptId: true,
      providerRunId: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (
    !match
    || !match.revokedAt
    || match.expiresAt <= new Date()
    || !match.taskId
    || !match.workspaceId
    || !match.runId
    || !match.runtimeSessionKey
  ) return null;
  return {
    token,
    taskId: match.taskId,
    workspaceId: match.workspaceId,
    taskSessionId: match.taskSessionId,
    runId: match.runId,
    runtimeSessionKey: match.runtimeSessionKey,
    nodeId: match.nodeId,
    nodeAttemptId: match.nodeAttemptId,
    providerRunId: match.providerRunId,

  };
}

export async function revokeRunToken(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const result = await db.runToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

export async function revokeRunTokensForRun(runId: string): Promise<number> {
  const result = await db.runToken.updateMany({
    where: { runId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function recordTerminalAction(input: {
  scope: RunTokenScope | Omit<RunTokenScope, "token">;
  kind: AgentControlActionKind;
  payload: unknown;
  workspaceId: string;
}): Promise<{ action: RecordedTerminalAction; recorded: boolean }> {
  const { workspaceId } = input;
  if (input.scope.nodeAttemptId) {
    const existing = await db.taskPlanTerminalAction.findFirst({
      where: { nodeAttemptId: input.scope.nodeAttemptId },
      orderBy: { recordedAt: "asc" },
    }) as RecordedTerminalAction | null;
    if (existing?.kind === input.kind) return { action: existing, recorded: false };
    if (existing) throw new ConflictingTerminalActionError(existing.kind, input.kind);
  }
  try {
    const created = await db.taskPlanTerminalAction.create({
      data: {
        workspaceId,
        taskId: input.scope.taskId,
        runId: input.scope.runId,
        taskSessionId: input.scope.taskSessionId,
        runtimeSessionKey: input.scope.runtimeSessionKey,
        nodeId: input.scope.nodeId,
        nodeAttemptId: input.scope.nodeAttemptId,
        kind: input.kind,
        payload: input.payload as never,
      },
    }) as RecordedTerminalAction;
    return { action: created, recorded: true };
  } catch (error) {
    if (
      typeof error !== "object"
      || error === null
      || !("code" in error)
      || error.code !== "P2002"
      || !input.scope.nodeAttemptId
    ) {
      throw error;
    }
    const existing = await db.taskPlanTerminalAction.findFirst({
      where: { nodeAttemptId: input.scope.nodeAttemptId },
      orderBy: { recordedAt: "asc" },
    }) as RecordedTerminalAction | null;
    if (existing?.kind === input.kind) return { action: existing, recorded: false };
    if (existing) throw new ConflictingTerminalActionError(existing.kind, input.kind);
    throw error;
  }
}

export async function latestRecordedTerminalAction(input: {
  runId: string;
  nodeAttemptId?: string | null;
}): Promise<RecordedTerminalAction | null> {
  return db.taskPlanTerminalAction.findFirst({
    where: {
      runId: input.runId,
      nodeAttemptId: input.nodeAttemptId ?? null,
    },
    orderBy: { recordedAt: "desc" },
  }) as Promise<RecordedTerminalAction | null>;
}

export async function findRecordedTerminalAction(input: {
  nodeAttemptId: string;
  kind: AgentControlActionKind;
}): Promise<RecordedTerminalAction | null> {
  return db.taskPlanTerminalAction.findFirst({
    where: { nodeAttemptId: input.nodeAttemptId, kind: input.kind },
    orderBy: { recordedAt: "desc" },
  }) as Promise<RecordedTerminalAction | null>;
}