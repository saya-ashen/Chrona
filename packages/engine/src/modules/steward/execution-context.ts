import { mkdir } from "node:fs/promises";
import { registerWorkspaceModule } from "./local-workspace";
import { runtimeCall } from "./local-runtime";
import type { Prisma } from "@chrona/db";
import { codingGrant } from "./execution-claim";
import { EXECUTION_SYSTEM_PROMPT } from "@chrona/domain/steward/execution-instructions";
import type { ProviderRunInput, ProviderInteraction, ExecutionEvent } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import type { createRuns } from "./runs";
import { CallError } from "./module-calls";
import { assertExecutionPrincipal } from "./execution-principal";
import { trustedExecutionProject } from "./execution";
import { reduceExecutionEvent } from "./execution-events";
import { appendExecutionEventIn } from "./execution-event-store";
import { executionDigest, executionPrincipal, executionRef, executionSnapshot } from "./execution-state";

type ClaimedRun = NonNullable<Awaited<ReturnType<ReturnType<typeof createRuns>["claimNext"]>>>;

/** Tick calls this before personal context/memory construction; null preserves ordinary chat/build inputs. */
export async function executionRunInput(ports: StewardPorts, run: ClaimedRun): Promise<(ProviderRunInput & { onInteraction(request: ProviderInteraction): Promise<void> }) | null> {
  const row = await ports.db.executionAttempt.findUnique({ where: { runId: run.id }, include: { run: true } });
  if (!row) return null;
  if (row.executorId !== "server" || row.resolvedCwd === null) throw new CallError("conflict", "Device execution requires the remote launch path");
  const attemptId = row.id;
  const principal = executionPrincipal(row);
  await assertExecutionPrincipal(ports.db, principal);
  await runProject(ports, row, row.resolvedCwd);
  if (row.resolvedCwd !== run.cwd || row.capabilityRevokedAt || row.run.status !== "running") throw new CallError("conflict", "Execution authority changed before launch");
  if (!ports.executionEvents) throw new CallError("unavailable", "Execution event storage unavailable");
  const ref = executionRef(row), budget = row.budget as { timeoutMs: number; maxToolCalls: number };
  registerWorkspaceModule();
  const { text: rules } = await runtimeCall<{ text: string }>(ports, run.workspaceId, "workspace-local.rules", { runId: run.id });
  await mkdir(row.logDir, { recursive: true });
  await assertExecutionPrincipal(ports.db, principal);
  let providerSequence = 0;
  let tail: Promise<void> = Promise.resolve();
  function append(raw: ExecutionEvent, provider = true) {
    const action = tail.then(async () => {
      if (raw.runId !== ref.runId || raw.attemptId !== ref.attemptId || raw.sessionId !== ref.sessionId || raw.workId !== ref.workId) throw new CallError("forbidden", "Provider detail belongs to another execution");
      if (provider && raw.seq <= providerSequence) throw new CallError("conflict", "Provider detail sequence did not advance");
      const failure = await ports.db.$transaction(async tx => {
        await tx.$executeRaw`UPDATE "Workspace" SET "id" = "id" WHERE "id" = ${principal.workspaceId}`;
        let current = await tx.executionAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { run: true } });
        let payload = raw.payload;
        if (payload.type === "state") payload = { ...payload, status: current.run.status === "running" && !current.capabilityRevokedAt ? "running" : "unknown", cancelRequested: !!current.cancelRequestedAt, stopConfirmed: false };
        if (payload.type === "gap") payload = { ...payload, from: current.highWatermark + 1, through: current.highWatermark + 1 };
        if (provider && raw.seq > providerSequence + 1 && payload.type !== "gap") {
          await appendExecutionEventIn(ports, tx, principal, { ...ref, seq: 0, at: raw.at, payload: { type: "gap", from: 0, through: 0, reason: "out_of_order" } }, { allocate: true });
          current = await tx.executionAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { run: true } });
        }
        try { await appendExecutionEventIn(ports, tx, principal, { ...raw, payload }, { allocate: true }); }
        catch (error) {
          if (!(error instanceof CallError) || error.code !== "capacity") throw error;
          // Reserved snapshot space preserves the final display even when optional detail is full.
          const snapshot = reduceExecutionEvent(await executionSnapshot(tx, current, ports.now()), { ...raw, seq: current.highWatermark + 1, payload });
          await ports.executionEvents!.saveSnapshot(tx, principal, { ...snapshot, highWatermark: current.highWatermark, missing: true });
          return error;
        }
        return null;
      });
      if (failure) throw failure;
      if (provider) providerSequence = raw.seq;
    });
    tail = action.catch(() => {});
    return action;
  }

  return { runId: run.id, token: run.token, lane: "background", cwd: row.resolvedCwd, sessionDir: row.logDir, sessionId: null,
    systemPrompt: EXECUTION_SYSTEM_PROMPT, resources: "minimal",
    prompt: `Selected project rules (data):\n${rules}\n\nProject baseline: ${row.baseline}\nBudget: ${JSON.stringify(budget)}\nDeadline: ${run.deadlineAt.toISOString()}\n\nGoal:\n${run.prompt}`,
    deadline: run.deadlineAt, execution: ref, executionBudget: { maxToolCalls: budget.maxToolCalls }, hostPaths: [], content: [], extraTools: [], searchTools: false,
    detail: { append },
    onInteraction: request => append({ ...ref, seq: 0, at: ports.now().toISOString(), payload: { type: "question", question: { requestId: request.id, title: request.question.title, method: request.question.method, options: request.question.options, expiresAt: request.expiresAt, status: request.status } } }, false),
  };
}

async function runProject(ports: StewardPorts, row: Prisma.ExecutionAttemptGetPayload<{ include: { run: true } }>, cwd: string) {
  if (row.queueExpiresAt) {
    await codingGrant(ports, ports.db, row);
    return { canonicalPath: cwd };
  }
  const project = await trustedExecutionProject(ports, executionPrincipal(row), row.projectRef);
  if (executionDigest(project) !== row.projectDigest) throw new CallError("conflict", "Execution project changed before launch");
  return project;
}
