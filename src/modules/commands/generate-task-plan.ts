import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

function buildMockTaskPlanPayload(task: {
  title: string;
  prompt: string | null;
  status: string;
  blockReason: unknown;
}, revision: "generated" | "updated") {
  const promptSummary = typeof task.prompt === "string" && task.prompt.trim().length > 0
    ? `当前任务说明会作为首轮执行约束：${task.prompt.trim().slice(0, 120)}`
    : `当前任务会先围绕「${task.title}」拆解目标与限制，再推进首轮产出。`;
  const blockSummary =
    task.blockReason && typeof task.blockReason === "object" && !Array.isArray(task.blockReason)
      ? (task.blockReason as { actionRequired?: string }).actionRequired
      : null;

  return {
    revision,
    generated_by: "work-plan-agent",
    is_mock: true,
    summary: `先澄清目标与背景，再执行首轮产出，并把需要你确认的节点收束到工作台右侧的任务计划中。`,
    change_summary:
      revision === "updated"
        ? `已根据当前状态重新整理占位计划${blockSummary ? `：当前关注点是${blockSummary}` : ""}。`
        : `已基于当前任务背景生成初始占位计划。${task.status === "Ready" ? "现在可以直接开始第一轮执行。" : "后续会随运行状态自动更新。"}`,
    notes: [promptSummary],
    steps: [
      {
        id: "understand-task",
        title: "梳理目标与约束",
        objective: "确认这项任务的目标、交付物、限制条件和判断标准。",
        phase: "理解",
      },
      {
        id: "gather-context",
        title: "补齐上下文",
        objective: "收集已有背景、历史记录和当前阻塞点，明确执行边界。",
        phase: "准备",
      },
      {
        id: "execute-task",
        title: "推进首轮产出",
        objective: "让 Agent 执行主要工作，并持续同步关键进展或审批节点。",
        phase: "执行",
      },
      {
        id: "confirm-next-step",
        title: "确认结果与下一步",
        objective: "根据最新结果决定是确认完成、补充要求，还是继续下一轮。",
        phase: "确认",
      },
    ],
  };
}

export async function generateTaskPlan(input: { taskId: string }) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      prompt: true,
      status: true,
      blockReason: true,
    },
  });

  const latestPlanEvent = await db.event.findFirst({
    where: {
      taskId: task.id,
      eventType: { in: ["task.plan_generated", "task.plan_updated"] },
    },
    orderBy: [{ runtimeTs: "desc" }, { ingestSequence: "desc" }],
    select: { id: true },
  });

  const revision = latestPlanEvent ? "updated" : "generated";
  const eventType = revision === "updated" ? "task.plan_updated" : "task.plan_generated";
  const runtimeTs = new Date();

  await appendCanonicalEvent({
    eventType,
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "agent",
    actorId: "work-plan-agent",
    source: "planner",
    payload: buildMockTaskPlanPayload(task, revision),
    dedupeKey: `${eventType}:${task.id}:${runtimeTs.toISOString()}`,
    runtimeTs,
  });

  await rebuildTaskProjection(task.id);

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    revision,
  };
}
