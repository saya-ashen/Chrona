import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

import { db } from "@/lib/db";
import type { PlanBlueprint } from "@chrona/contracts";

import { getLatestTaskPlanGraph } from "@/modules/plans/task-plan-graph";
import { getLatestTaskPlanReadModel } from "@/modules/plans/task-plan-read-model";

async function generateTaskPlanForTask(input: {
  taskId: string;
  forceRefresh?: boolean;
  userInstruction?: string | null;
}) {
  const { generateTaskPlanManualStream } = await import("@/modules/plans/generate-task-plan-manual-stream");
  let result: Awaited<ReturnType<typeof getLatestTaskPlanGraph>> | null = null;
  for await (const event of generateTaskPlanManualStream(input)) {
    if (event.type === "result") {
      result = await getLatestTaskPlanGraph(input.taskId);
    }
    if (event.type === "error") {
      return null;
    }
  }
  return result;
}

async function generateAndAcceptTaskPlanForTask(input: { taskId: string; accept?: boolean }) {
  const { generateAndAcceptTaskPlan } = await import("@/modules/plans/auto-generate-task-plan");
  await generateAndAcceptTaskPlan(input);
}

const aiGeneratePlanMock = mock(async (request: { title: string; description?: string }): Promise<PlanBlueprint> => ({
  title: `Plan for ${request.title}`,
  goal: request.description ?? request.title,
  nodes: [
    {
      id: "handle_task",
      type: "task" as const,
      title: `Handle ${request.title}`,
      expectedOutput: request.description ?? request.title,
    },
  ],
  edges: [],
}));

let streamStyle: "full" | "hermes" | "hermes-no-save" | "text-json-done" | "provider-error-done" = "full";
let planToolName = "chrona_plan_generate";

import { materializeGeneratedTaskPlan } from "./materialize-generated-task-plan";

async function* aiGeneratePlanStreamMock(request: { title: string; description?: string; taskId: string }) {
  const blueprint = await aiGeneratePlanMock(request);


  if (streamStyle === "text-json-done") {
    yield { type: "done" as const, text: JSON.stringify(blueprint) };
    return;
  }


  if (streamStyle === "provider-error-done") {
    yield { type: "done" as const, text: "unexpected status 502 Bad Gateway: upstream unavailable" };
    return;
  }

  if (streamStyle === "hermes" || streamStyle === "hermes-no-save") {
    yield { type: "tool_call" as const, tool: "chrona_plan_generate", input: { preview: "generating plan..." } };
    // Simulate what real Chrona-owned tool does: persist plan via DB.
    // In production the Hermes provider runs the tool internally and calls
    // chrona.plan.generate, which persists to DB behind the scenes.
    if (streamStyle === "hermes") {
      const task = await db.task.findUnique({ where: { id: request.taskId } });
      if (task) {
        await materializeGeneratedTaskPlan({
          taskId: task.id,
          workspaceId: task.workspaceId,
          blueprint,
          generatedBy: "hermes",
        });
      }
    }
    yield { type: "done" as const, text: "done" };
    return;
  }

  yield { type: "tool_call" as const, tool: planToolName, input: blueprint };

  if (blueprint.nodes.length === 0) {
    yield {
      type: "tool_result" as const,
      tool: planToolName,
      result: "Plan blueprint must contain at least one node.",
      error: true,
    };
    return;
  }

  yield { type: "tool_result" as const, tool: planToolName, result: "completed" };
  yield { type: "done" as const, text: "done" };
}

mock.module("@/modules/ai/runtime/ai-service", () => ({
  aiChat: mock(() => Promise.resolve(null)),
  aiGeneratePlanStream: aiGeneratePlanStreamMock,
}));

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolInvocation.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.taskPlanNodeAttempt.deleteMany();
  await db.taskPlanRun.deleteMany();
  await db.taskPlan.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskSession.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("generateTaskPlanForTask", () => {
  beforeEach(async () => {
    await resetDb();
    streamStyle = "full";
    planToolName = "chrona_plan_generate";
    aiGeneratePlanMock.mockClear();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("generates and saves a draft plan from persisted task fields", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Plan Command", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Updated task title",
        description: "Updated description from DB",
        status: "Ready",
        priority: "High",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    const workBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date("2026-04-12T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-12T10:30:00.000Z"),
        trigger: "manual",
      },
    });

    const result = await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });

    expect(result?.summary).toBe("Plan for Updated task title");
    expect(aiGeneratePlanMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: task.id,
      title: "Updated task title",
      description: "Updated description from DB",
      estimatedMinutes: 90,
      sessionKey: `chrona:task:${task.id}:work-block:${workBlock.id}:plan-generation`,
    }));

    const saved = await getLatestTaskPlanGraph(task.id);
    expect(saved!.id.startsWith("plan_")).toBe(false);
    const refreshedTask = await db.task.findUnique({ where: { id: task.id } });
    const sessions = await db.taskSession.findMany({ where: { taskId: task.id } });
    const activityEvents = await db.event.findMany({
      where: { taskId: task.id, source: "plan_generation" },
      orderBy: { ingestSequence: "asc" },
    });
    const node = saved!.plan.nodes[0];
    expect(node?.title).toBe("Handle Updated task title");
    expect(node?.localId).toBe("handle_task");
    expect(node?.id).not.toBe(node?.localId);
    expect(saved?.plan.completionPolicy).toEqual({ type: "all_tasks_completed" });
    expect(refreshedTask?.defaultSessionId).toBeNull();
    expect(sessions.map((session) => session.sessionKey)).toContain(
      `chrona:task:${task.id}:work-block:${workBlock.id}:plan-generation`,
    );
    expect(activityEvents.map((event) => event.eventType)).toEqual([
      "plan_generation.started",
      "plan_generation.status",
      "plan_generation.status",
      "plan_generation.tool_called",
      "plan_generation.draft_saved",
      "plan_generation.status",
      "plan_generation.completed",
    ]);
    expect(new Set(activityEvents.map((event) => event.workBlockId))).toEqual(new Set([workBlock.id]));
    expect(activityEvents[3]?.payload).toMatchObject({
      tool: "chrona_plan_generate",
      plan_title: "Plan for Updated task title",
      node_count: 1,
    });
  });

  it("fails when provider completes without calling the plan generation tool", async () => {
    streamStyle = "text-json-done";
    const workspace = await db.workspace.create({
      data: { name: "No tool call", status: "Active", defaultRuntime: "codex" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Codex JSON fallback task",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "codex",
        executionConfig: {},
      },
    });

    const result = await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });

    expect(result).toBeNull();
    await expect(getLatestTaskPlanReadModel(task.id)).resolves.toBeNull();
    const failure = await db.event.findFirst({
      where: { taskId: task.id, eventType: "plan_generation.failed" },
    });
    expect(failure?.payload).toMatchObject({
      code: "INVALID_TOOL_PAYLOAD",
      message: "Provider completed without calling chrona_plan_generate.",
    });
  });

  it("reports provider transport failures instead of missing tool payload", async () => {
    streamStyle = "provider-error-done";
    const workspace = await db.workspace.create({
      data: { name: "Provider failure", status: "Active", defaultRuntime: "codex" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Gateway failure task",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "codex",
        executionConfig: {},
      },
    });

    const result = await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });

    expect(result).toBeNull();
    const failure = await db.event.findFirst({
      where: { taskId: task.id, eventType: "plan_generation.failed" },
    });
    expect(failure?.payload).toMatchObject({
      code: "PROVIDER_ERROR",
      message: "unexpected status 502 Bad Gateway: upstream unavailable",
    });
  });

  it("accepts Claude Code MCP-prefixed plan tool calls", async () => {
    planToolName = "mcp__chrona__chrona_plan_generate";
    const workspace = await db.workspace.create({
      data: { name: "Prefixed plan tool", status: "Active", defaultRuntime: "claude_code" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Claude Code plan task",
        status: "Ready",
        priority: "High",
        executionRuntime: "claude_code",
        executionConfig: {},
      },
    });

    const result = await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });

    expect(result?.summary).toBe("Plan for Claude Code plan task");
    const failure = await db.event.findFirst({
      where: { taskId: task.id, eventType: "plan_generation.failed" },
    });
    expect(failure).toBeNull();
  });

  it("stores regeneration user instruction on the generated plan", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Plan Instruction", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Instruction task",
        status: "Ready",
        priority: "High",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    const result = await generateTaskPlanForTask({
      taskId: task.id,
      forceRefresh: true,
      userInstruction: "Add an explicit verification step before final output.",
    });

    const savedPlan = await getLatestTaskPlanReadModel(task.id);
    expect(result?.planId).toBe(savedPlan?.id);
    expect(savedPlan?.prompt).toBe("Add an explicit verification step before final output.");
    expect(aiGeneratePlanMock).toHaveBeenCalledWith(expect.objectContaining({
      userInstruction: "Add an explicit verification step before final output.",
    }));
  });

  it("generates and accepts plans for auto-execute tasks", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Auto Accept Plan", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Auto execute plan",
        status: "Draft",
        priority: "High",
        autoExecute: true,
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    await generateAndAcceptTaskPlanForTask({ taskId: task.id });

    const savedPlan = await getLatestTaskPlanReadModel(task.id);
    expect(savedPlan?.status).toBe("accepted");
    expect(aiGeneratePlanMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: task.id,
      title: "Auto execute plan",
    }));
  });

  it("generates draft plans without accepting when auto-plan only is enabled", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Auto Draft Plan", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Auto plan only",
        status: "Draft",
        priority: "High",
        autoPlanGeneration: true,
        autoExecute: false,
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    await generateAndAcceptTaskPlanForTask({ taskId: task.id, accept: false });

    const savedPlan = await getLatestTaskPlanReadModel(task.id);
    expect(savedPlan?.status).toBe("draft");
    expect(aiGeneratePlanMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: task.id,
      title: "Auto plan only",
    }));
  });

  it("always regenerates plans through the manual stream", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Cached Plan", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Cached title",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });
    aiGeneratePlanMock.mockClear();

    const result = await generateTaskPlanForTask({ taskId: task.id });

    expect(result).not.toBeNull();
    expect(result?.planId).toBeTruthy();
    expect(aiGeneratePlanMock).toHaveBeenCalledTimes(1);
  });

  it("does not save an empty generated blueprint", async () => {
    aiGeneratePlanMock.mockImplementationOnce(async () => ({
      title: "",
      goal: "",
      nodes: [],
      edges: [],
    }));

    const workspace = await db.workspace.create({
      data: { name: "Invalid Plan", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Broken planner output",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    const result = await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });

    expect(result).toBeNull();
    expect(await getLatestTaskPlanGraph(task.id)).toBeNull();
  });

  it("enriches compiled nodes and derives runtime dependencies", async () => {
    aiGeneratePlanMock.mockImplementationOnce(async () => ({
      title: "Enriched plan",
      goal: "Test compiled enrichment",
      nodes: [
        {
          id: "auto_step",
          type: "task" as const,
          title: "Auto step",
          executor: "ai" as const,
          mode: "auto" as const,
        },
        {
          id: "approve_step",
          type: "checkpoint" as const,
          title: "Approve it",
          checkpointType: "approve" as const,
          prompt: "Approve before continuing",
        },
        {
          id: "manual_step",
          type: "task" as const,
          title: "Manual step",
          executor: "user" as const,
          mode: "manual" as const,
        },
      ],
      edges: [
        { from: "auto_step", to: "approve_step" },
        { from: "approve_step", to: "manual_step" },
      ],
    }));

    const workspace = await db.workspace.create({
      data: { name: "Enriched Plan", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Enriched test task",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });
    const saved = await getLatestTaskPlanGraph(task.id);

    const autoNode = saved!.plan.nodes.find((node) => node.localId === "auto_step");
    const approvalNode = saved!.plan.nodes.find((node) => node.localId === "approve_step");
    const manualNode = saved!.plan.nodes.find((node) => node.localId === "manual_step");

    expect(autoNode).toBeDefined();
    expect(autoNode?.executor).toBe("ai");
    expect(autoNode?.mode).toBe("auto");
    expect(approvalNode).toBeDefined();
    expect(approvalNode?.type).toBe("checkpoint");
    expect(manualNode).toBeDefined();
    expect(manualNode?.executor).toBe("user");
    expect(manualNode?.mode).toBe("manual");
    expect(manualNode?.dependencies).toContain(approvalNode!.id);
  });

  it("emits result event when tool_call is followed by done (Hermes Chrona-owned tool)", async () => {
    streamStyle = "hermes";

    const workspace = await db.workspace.create({
      data: { name: "Hermes Tool Only", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Hermes plan test",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    const events: Array<{ type: string }> = [];
    const { generateTaskPlanManualStream } = await import("@/modules/plans/generate-task-plan-manual-stream");
    for await (const event of generateTaskPlanManualStream({ taskId: task.id, forceRefresh: true })) {
      events.push({ type: event.type });
    }

    expect(events.map((e) => e.type)).toContain("result");

    const savedPlan = await getLatestTaskPlanReadModel(task.id);
    expect(savedPlan).not.toBeNull();
    expect(savedPlan?.status).toBe("draft");
  });

  it("finds plan when Hermes tool saves with NULL workBlockId but caller passes concrete one", async () => {
    streamStyle = "hermes";

    const workspace = await db.workspace.create({
      data: { name: "Hermes workBlock mismatch", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Hermes mismatch",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    const workBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-01T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-01T10:00:00.000Z"),
        trigger: "manual",
      },
    });

    const events: Array<{ type: string }> = [];
    const { generateTaskPlanManualStream } = await import("@/modules/plans/generate-task-plan-manual-stream");
    for await (const event of generateTaskPlanManualStream({
      taskId: task.id,
      workBlockId: workBlock.id,
      forceRefresh: true,
    })) {
      events.push({ type: event.type });
    }

    expect(events.map((e) => e.type)).toContain("result");

    const savedPlan = await getLatestTaskPlanReadModel(task.id, workBlock.id);
    expect(savedPlan).not.toBeNull();
    expect(savedPlan?.status).toBe("draft");
  });

  it("does not report a completed work-block generation from a different occurrence's saved plan", async () => {
    streamStyle = "hermes-no-save";

    const workspace = await db.workspace.create({
      data: { name: "Hermes stale occurrence", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Recurring trend task",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    const previousWorkBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: "Previous occurrence",
        status: "Completed",
        scheduledStartAt: new Date("2026-06-05T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-05T10:00:00.000Z"),
        trigger: "manual",
      },
    });
    const targetWorkBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: "Target occurrence",
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-06T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-06T10:00:00.000Z"),
        trigger: "manual",
      },
    });
    await materializeGeneratedTaskPlan({
      taskId: task.id,
      workspaceId: workspace.id,
      workBlockId: previousWorkBlock.id,
      blueprint: {
        title: "Previous plan",
        goal: "Existing accepted plan from another occurrence",
        nodes: [{ id: "previous", type: "task", title: "Previous step" }],
        edges: [],
      },
      generatedBy: "test",
    });
    await db.taskPlan.updateMany({
      where: { taskId: task.id, workBlockId: previousWorkBlock.id },
      data: { status: "Accepted" },
    });

    const events: Array<{ type: string; code?: string }> = [];
    const { generateTaskPlanManualStream } = await import("@/modules/plans/generate-task-plan-manual-stream");
    for await (const event of generateTaskPlanManualStream({
      taskId: task.id,
      workBlockId: targetWorkBlock.id,
      forceRefresh: true,
    })) {
      events.push(event.type === "error" ? { type: event.type, code: event.code } : { type: event.type });
    }

    expect(events).toContainEqual({ type: "error", code: "INTERNAL_ERROR" });
    expect(events.map((event) => event.type)).not.toContain("result");
    expect(await getLatestTaskPlanReadModel(task.id, targetWorkBlock.id)).toBeNull();
  });

  it("generates and accepts plans when Hermes stream has no tool_result", async () => {
    streamStyle = "hermes";

    const workspace = await db.workspace.create({
      data: { name: "Hermes Accept Plan", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Hermes auto accept",
        status: "Draft",
        priority: "High",
        autoExecute: true,
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    await generateAndAcceptTaskPlanForTask({ taskId: task.id });

    const savedPlan = await getLatestTaskPlanReadModel(task.id);
    expect(savedPlan?.status).toBe("accepted");
  });

  it("accepts plan when Hermes saves with NULL workBlockId but caller passes concrete one", async () => {
    streamStyle = "hermes";

    const workspace = await db.workspace.create({
      data: { name: "Hermes Accept wb mismatch", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Hermes accept mismatch",
        status: "Draft",
        priority: "High",
        autoExecute: true,
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    const workBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-01T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-01T10:00:00.000Z"),
        trigger: "manual",
      },
    });

    const { generateAndAcceptTaskPlan } = await import("@/modules/plans/auto-generate-task-plan");
    await generateAndAcceptTaskPlan({ taskId: task.id, workBlockId: workBlock.id });

    const savedPlan = await getLatestTaskPlanReadModel(task.id);
    expect(savedPlan?.status).toBe("accepted");
  });

  it("passes the imported calendar event description to the planner as source context", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Calendar plan context", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "获取今天的github trendings",
        description: "我的本地笔记",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });
    const source = await db.calendarSource.create({
      data: {
        workspaceId: workspace.id,
        name: "Team Calendar",
        sourceUrl: `file:///tmp/${crypto.randomUUID()}.ics`,
        redactedUrlLabel: "local fixture",
        color: "#2563eb",
        lifecycleState: "active",
      },
    });
    const calendarDescription = "读取今天最新的github trendings，并总结成一份markdown报告";
    await db.importedCalendarEvent.create({
      data: {
        workspaceId: workspace.id,
        calendarSourceId: source.id,
        taskId: task.id,
        externalUid: crypto.randomUUID(),
        dedupeKey: crypto.randomUUID(),
        title: task.title,
        startsAt: new Date("2026-06-06T14:00:00.000Z"),
        endsAt: new Date("2026-06-06T15:00:00.000Z"),
        isAllDay: false,
        status: "confirmed",
        description: calendarDescription,
      },
    });

    aiGeneratePlanMock.mockClear();
    await generateTaskPlanForTask({ taskId: task.id, forceRefresh: true });

    const request = aiGeneratePlanMock.mock.calls.at(-1)?.[0];
    // The editable Chrona note and the read-only calendar description are
    // surfaced to the planner as distinct fields, not merged or dropped.
    expect(request?.description).toBe("我的本地笔记");
    expect((request as { sourceContext?: string } | undefined)?.sourceContext).toBe(calendarDescription);
  });
});
