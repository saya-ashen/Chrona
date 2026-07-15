import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import type { AgentControlActionKind } from "@chrona/contracts/api";

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type RunTokenScope = {
  token: string;
  taskId: string;
  workspaceId: string;
  taskSessionId: string | null;
  runId: string;
  runtimeSessionKey: string;
  nodeId: string | null;
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

function safeTokenEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function mintRunToken(input: {
  taskId: string;
  workspaceId: string;
  taskSessionId?: string | null;
  runId: string;
  runtimeSessionKey: string;
  nodeId?: string | null;
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
      expiresAt: input.expiresAt ?? new Date(Date.now() + TOKEN_TTL_MS),
    },
  });
  return token;
}

export async function validateRunToken(token: string): Promise<RunTokenScope | null> {
  const tokenHash = hashToken(token);
  const candidates = await db.runToken.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      tokenHash: true,
      taskId: true,
      workspaceId: true,
      taskSessionId: true,
      runId: true,
      runtimeSessionKey: true,
      nodeId: true,
      nodeAttemptId: true,
    },
  });
  const match = candidates.find((candidate) => safeTokenEquals(candidate.tokenHash, tokenHash));
  if (!match || !match.taskId || !match.workspaceId || !match.runId || !match.runtimeSessionKey) return null;
  return {
    token,
    taskId: match.taskId,
    workspaceId: match.workspaceId,
    taskSessionId: match.taskSessionId,
    runId: match.runId,
    runtimeSessionKey: match.runtimeSessionKey,
    nodeId: match.nodeId,
    nodeAttemptId: match.nodeAttemptId,
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