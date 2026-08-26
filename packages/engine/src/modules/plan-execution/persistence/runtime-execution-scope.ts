/* eslint-disable max-lines-per-function, complexity -- Runtime scope validation intentionally checks every linked durable identity. */
import type { Prisma } from "@/generated/prisma/client";

export type RuntimeExecutionScope = {
  workspaceId: string;
  taskId: string;
  workBlockId: string | null;
  occurrenceId: string | null;
  runId: string;
  taskSessionId: string;
  executionSessionId: string;
  planId: string;
  planRunId: string;
  nodeAttemptId: string;
  executionScope: string;
  providerRunId: string;
  runtimeName: string;
  providerClientId?: string;
  providerConfigFingerprint?: string;
  nodeContext?: {
    nodeId: string;
    nodeTitle: string;
  };
};

export type RuntimeScopeAssertionOptions = {
  runStatuses?: string[];
  providerRunStatuses?: string[];
  nodeAttemptStatuses?: string[];
};

const ACTIVE_RUN_STATUSES = ["Pending", "Running", "WaitingForApproval", "WaitingForInput"];
const ACTIVE_PROVIDER_STATUSES = ["running", "waiting_for_approval"];
const ACTIVE_ATTEMPT_STATUSES = ["running", "waiting_for_approval"];

export async function assertRuntimeExecutionScope(
  tx: Prisma.TransactionClient,
  context: RuntimeExecutionScope,
  options: RuntimeScopeAssertionOptions = {},
): Promise<void> {
  const [run, providerRun, planRun, executionSession] = await Promise.all([
    tx.run.findFirst({
      where: { id: context.runId, taskId: context.taskId },
      select: {
        status: true,
        taskSessionId: true,
        workBlockId: true,
        occurrenceId: true,
        providerClientId: true,
        providerName: true,
        providerConfigFingerprint: true,
        taskSession: {
          select: {
            providerClientId: true,
            providerName: true,
            providerConfigFingerprint: true,
          },
        },
        task: { select: { workspaceId: true } },
      },
    }),
    tx.taskPlanProviderRun.findFirst({
      where: { id: context.providerRunId, taskId: context.taskId, workspaceId: context.workspaceId },
      select: {
        status: true,
        runId: true,
        planId: true,
        planRunId: true,
        nodeAttemptId: true,
        aiClientId: true,
        aiClientConfigDigest: true,
        providerName: true,
        nodeAttempt: { select: { status: true, executionEpoch: true } },
      },
    }),
    tx.taskPlanRun.findFirst({
      where: { id: context.planRunId, taskId: context.taskId, workspaceId: context.workspaceId },
      select: { planId: true, workBlockId: true, occurrenceId: true, executionEpoch: true, executionScopeId: true },
    }),
    tx.executionSession.findFirst({
      where: { id: context.executionSessionId, taskId: context.taskId },
      select: { status: true, planId: true, workBlockId: true, currentNodeAttemptId: true },
    }),
  ]);
  const runStatuses = options.runStatuses ?? ACTIVE_RUN_STATUSES;
  const providerRunStatuses = options.providerRunStatuses ?? ACTIVE_PROVIDER_STATUSES;
  const nodeAttemptStatuses = options.nodeAttemptStatuses ?? ACTIVE_ATTEMPT_STATUSES;
  const matches = run
    && providerRun
    && planRun
    && executionSession
    && runStatuses.includes(run.status)
    && providerRunStatuses.includes(providerRun.status)
    && nodeAttemptStatuses.includes(providerRun.nodeAttempt.status)
    && providerRun.nodeAttempt.executionEpoch <= planRun.executionEpoch
    && executionSession.status === "Active"
    && executionSession.planId === context.planId
    && executionSession.workBlockId === context.workBlockId
    && executionSession.currentNodeAttemptId === context.nodeAttemptId
    && run.task.workspaceId === context.workspaceId
    && run.taskSessionId === context.taskSessionId
    && run.workBlockId === context.workBlockId
    && run.occurrenceId === context.occurrenceId
    && (!context.providerClientId || run.providerClientId === context.providerClientId)
    && (!context.providerClientId || run.providerName === context.runtimeName)
    && (!context.providerConfigFingerprint || run.providerConfigFingerprint === context.providerConfigFingerprint)
    && (!context.providerClientId || run.taskSession?.providerClientId === context.providerClientId)
    && (!context.providerClientId || run.taskSession?.providerName === context.runtimeName)
    && (!context.providerConfigFingerprint || run.taskSession?.providerConfigFingerprint === context.providerConfigFingerprint)
    && providerRun.runId === context.runId
    && providerRun.planId === context.planId
    && providerRun.planRunId === context.planRunId
    && providerRun.nodeAttemptId === context.nodeAttemptId
    && (!context.providerClientId || providerRun.aiClientId === context.providerClientId)
    && (!context.providerConfigFingerprint || providerRun.aiClientConfigDigest === context.providerConfigFingerprint)
    && (!context.providerClientId || providerRun.providerName === context.runtimeName)
    && planRun.planId === context.planId
    && planRun.executionScopeId === context.executionScope
    && planRun.workBlockId === context.workBlockId
    && planRun.occurrenceId === context.occurrenceId;
  if (!matches) throw new Error(`Provider runtime scope no longer matches active execution for run ${context.runId}`);

  const planClaim = await tx.taskPlanRun.updateMany({
    where: {
      id: context.planRunId,
      executionEpoch: planRun!.executionEpoch,
      workBlockId: context.workBlockId,
      occurrenceId: context.occurrenceId,
    },
    data: { executionEpoch: planRun!.executionEpoch },
  });
  const runClaim = await tx.run.updateMany({
    where: {
      id: context.runId,
      taskId: context.taskId,
      status: run!.status,
      taskSessionId: context.taskSessionId,
      workBlockId: context.workBlockId,
      occurrenceId: context.occurrenceId,
    },
    data: { status: run!.status },
  });
  const attemptClaim = await tx.taskPlanNodeAttempt.updateMany({
    where: {
      id: context.nodeAttemptId,
      planRunId: context.planRunId,
      executionEpoch: providerRun!.nodeAttempt.executionEpoch,
      status: providerRun!.nodeAttempt.status,
    },
    data: { status: providerRun!.nodeAttempt.status },
  });
  const providerClaim = await tx.taskPlanProviderRun.updateMany({
    where: {
      id: context.providerRunId,
      runId: context.runId,
      planRunId: context.planRunId,
      nodeAttemptId: context.nodeAttemptId,
      status: providerRun!.status,
    },
    data: { status: providerRun!.status },
  });
  const sessionClaim = await tx.executionSession.updateMany({
    where: {
      id: context.executionSessionId,
      taskId: context.taskId,
      planId: context.planId,
      workBlockId: context.workBlockId,
      status: "Active",
    },
    data: { status: "Active" },
  });
  if ([planClaim.count, runClaim.count, attemptClaim.count, providerClaim.count, sessionClaim.count].some((count) => count !== 1)) {
    throw new Error(`Provider runtime scope changed before persistence for run ${context.runId}`);
  }
}
