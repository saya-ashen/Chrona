import {
  getAcceptedCompiledPlan,
  getLatestPlanScope,
  type SavedCompiledPlan,
} from "./compiled-plan-store";
import { db } from "@/lib/db";
import { getActiveExecutionSessionScope } from "./execution-session-store";

/**
 * The resolved execution context for a task. `workBlockId` is the canonical
 * work block that task-scoped operations (plan reads, node output submission,
 * dispatch) should target. For non-recurring tasks — or tasks whose plan is
 * task-scoped — this is `null`.
 */
export type ExecutionScope = {
  workBlockId: string | null;
  planId: string | null;
  executionSessionId: string | null;
};

/**
 * Single source of truth for "which work block is this operation about".
 *
 * Historically every task-scoped read invented its own `workBlockId ?? null`
 * default plus a one-directional fallback (concrete -> null), which silently
 * collapsed to the null scope whenever a caller only held a `taskId` (every MCP
 * tool, the graph-advancement worker, etc.). A plan accepted against a concrete
 * work block then became invisible, surfacing as "No accepted plan".
 *
 * Resolution precedence:
 *  1. An explicit concrete `workBlockId` from the caller (e.g. the UI viewing a
 *     specific occurrence) always wins.
 *  2. The live Active/Paused ExecutionSession — the authoritative record of what
 *     a running provider is executing right now.
 *  3. The work block of the most recent *accepted* plan (reads before a run
 *     starts or after it finishes).
 *  4. The work block of the most recent plan in any state (draft).
 *  5. `null` — no plan/work block yet.
 *
 * A `null`/`undefined` hint means "resolve it for me"; only a concrete string
 * pins the scope explicitly.
 */
export async function resolveExecutionScope(
  taskId: string,
  hint?: { workBlockId?: string | null; sessionId?: string | null },
): Promise<ExecutionScope> {
  if (typeof hint?.workBlockId === "string" && hint.workBlockId.length > 0) {
    return { workBlockId: hint.workBlockId, planId: null, executionSessionId: null };
  }

  const workBlockIdFromSessionKey = parseWorkBlockPlanSessionKey(taskId, hint?.sessionId);
  if (workBlockIdFromSessionKey) {
    const workBlock = await db.workBlock.findFirst({
      where: { id: workBlockIdFromSessionKey, taskId },
      select: { id: true, planId: true },
    });
    if (workBlock) {
      return { workBlockId: workBlock.id, planId: workBlock.planId, executionSessionId: null };
    }
  }

  if (typeof hint?.sessionId === "string" && hint.sessionId.length > 0) {
    const session = await db.taskSession.findFirst({
      where: {
        taskId,
        OR: [{ id: hint.sessionId }, { sessionKey: hint.sessionId }],
      },
      select: { id: true },
    });
    const workBlock = session
      ? await db.workBlock.findFirst({
          where: { taskId, sessionId: session.id },
          select: { id: true, planId: true },
        })
      : null;
    if (workBlock) {
      return { workBlockId: workBlock.id, planId: workBlock.planId, executionSessionId: null };
    }
  }

  const active = await getActiveExecutionSessionScope(taskId);
  if (active) {
    return {
      workBlockId: active.workBlockId,
      planId: active.planId,
      executionSessionId: active.executionSessionId,
    };
  }

  const acceptedScope = await getLatestPlanScope(taskId, { acceptedOnly: true });
  if (acceptedScope) {
    return { workBlockId: acceptedScope.workBlockId, planId: acceptedScope.planId, executionSessionId: null };
  }

  const latestScope = await getLatestPlanScope(taskId);
  if (latestScope) {
    return { workBlockId: latestScope.workBlockId, planId: latestScope.planId, executionSessionId: null };
  }

  return { workBlockId: null, planId: null, executionSessionId: null };
}

/**
 * Convenience wrapper for the common case where only the resolved work block is
 * needed. Returns the work block a task-scoped operation should target.
 */
export async function resolveScopeWorkBlockId(
  taskId: string,
  hint?: { workBlockId?: string | null; sessionId?: string | null },
): Promise<string | null> {
  return (await resolveExecutionScope(taskId, hint)).workBlockId;
}

function parseWorkBlockPlanSessionKey(taskId: string, sessionId?: string | null): string | null {
  const currentPrefix = `chrona:task:${taskId}:work-block:`;
  const currentSuffix = ":plan-generation";
  if (sessionId?.startsWith(currentPrefix) && sessionId.endsWith(currentSuffix)) {
    const workBlockId = sessionId.slice(currentPrefix.length, -currentSuffix.length);
    return workBlockId.length > 0 ? workBlockId : null;
  }

  const legacyPrefix = `chrona:task:${taskId}:wb:`;
  const legacySuffix = ":pg";
  if (!sessionId?.startsWith(legacyPrefix) || !sessionId.endsWith(legacySuffix)) return null;
  const workBlockId = sessionId.slice(legacyPrefix.length, -legacySuffix.length);
  return workBlockId.length > 0 ? workBlockId : null;
}

/**
 * Fetch the task's accepted plan at its canonical execution scope. Replaces the
 * `getAcceptedCompiledPlan(taskId)` calls that implicitly pinned the null scope
 * and so never saw a work-block-scoped accepted plan.
 *
 * The resolver decides *which* work block this operation targets; the lookup
 * then prefers that block's own accepted plan but falls back to a task-level
 * (null-scoped) plan, so a shared occurrence template still executes for a
 * concrete work block that has no per-occurrence plan of its own.
 */
export async function getAcceptedCompiledPlanForTask(
  taskId: string,
  hint?: { workBlockId?: string | null; sessionId?: string | null },
): Promise<SavedCompiledPlan | null> {
  const workBlockId = await resolveScopeWorkBlockId(taskId, hint);
  return (
    (await getAcceptedCompiledPlan(taskId, workBlockId))
    ?? (workBlockId ? await getAcceptedCompiledPlan(taskId, null) : null)
  );
}
