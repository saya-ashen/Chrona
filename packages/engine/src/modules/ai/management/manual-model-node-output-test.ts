import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { db, TaskPriority, TaskStatus } from "@chrona/db";
import type { CompiledPlan, NodeResult } from "@chrona/contracts/ai";
import { describeChronaNodeOutputPublicTool, parseChronaToolPayload } from "@chrona/contracts";
import { validateChronaSpec } from "@chrona/ui-protocol";

import { aiClientRegistry } from "../runtime/client-registry";
import { saveCompiledPlan } from "../../plan-execution/persistence/compiled-plan-store";
import { getPlanRun, savePlanRun } from "../../plan-execution/persistence/plan-run-store";
import { taskPlanExecution } from "../../plan-execution";
import { buildPlanExecutionTaskSessionId } from "../../execution-runtime";

const DEFAULT_NODE_PROMPT = "Create a small user-visible result for Chrona.";
const DEFAULT_EXPECTED_OUTPUT = "A json-render Spec with a heading and checklist proving the model used chrona_node_output before completion.";

function buildSchemaLabRuntimePrompt(input: { taskInfo: string }) {
  return [
    input.taskInfo,
    "SCHEMA LAB OVERRIDE:",
    "Call chrona_node_output exactly once. Do not call chrona_node_complete. Do not repair in multiple turns unless the tool itself returns an error.",
    "Task information:",
    input.taskInfo,
  ].join("\n\n");
}

async function getTimeline(taskId: string): Promise<Array<{ kind: string; title: string; body: string | null }>> {
  return await db.taskTimelineItem.findMany({
    where: { taskId },
    orderBy: { sortTime: "asc" },
    select: { kind: true, title: true, body: true },
  });
}
const RUNTIME_NAME = "claude_code";
const NODE_ID = "manual_model_node_output_task";
const RESULT_DIR = resolve(".omc", "manual-llm-tests");

type PreviousBinding = { id: string; feature: string; clientId: string } | null;

function normalizeManualText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function requireManualText(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}



type ManualModelNodeOutputTestInput = {
  clientId: string;
  baseUrl: string;
  prompt?: string;
  expectedOutput?: string;
  cleanup?: boolean;
};

export type ManualModelNodeOutputTestReport = {
  passed: true;
  taskId: string;
  workspaceId: string;
  planId: string;
  baseUrl: string;
  workspaceUrl: string;
  prompt: string;
  expectedOutput: string;
  actionKinds: string[];
  runIds: string[];
  outputSummary: string | null;
  outputCount: number;
  outputRoot: string | null;
  output: unknown;
  reportPath: string;
  timeline: Array<{ kind: string; title: string; body: string | null }>;
};

type ManualModelNodeOutputSchemaLabInput = {
  clientId: string;
  baseUrl: string;
  taskInfo?: string;
  prompt?: string;
  toolSchema?: string;
  cleanup?: boolean;
};

type NodeOutputAttemptReport = {
  index: number;
  callId: string | null;
  rawInput: unknown;
  toolResult: unknown;
  contractValid: boolean;
  runtimeValid: boolean;
  normalizedPayload: unknown;
  issues: string[];
};

export type ManualModelNodeOutputSchemaLabReport = {
  passed: boolean;
  taskId: string;
  workspaceId: string;
  sessionId: string;
  baseUrl: string;
  instructions: string;
  taskInfo: string;
  prompt: string;
  toolSchema: string;
  nodeOutputTool: ReturnType<typeof describeChronaNodeOutputPublicTool>;
  runIds: string[];
  toolCallCount: number;
  reportIssues: string[];
  textDeltas: string[];
  reportPath: string;
};

function buildCompiledPlan(planId: string, input: { prompt?: string; expectedOutput?: string }): CompiledPlan {
  const prompt = normalizeManualText(input.prompt, DEFAULT_NODE_PROMPT);
  const expectedOutput = normalizeManualText(input.expectedOutput, DEFAULT_EXPECTED_OUTPUT);
  return {
    id: `compiled_${planId}`,
    editablePlanId: planId,
    sourceVersion: 1,
    title: "Manual model node output protocol test",
    goal: "Verify a real model submits json-render output before completing a task node.",
    assumptions: [
      "This is a manual token-spending provider test and is not part of CI.",
    ],
    nodes: [
      {
        id: NODE_ID,
        localId: NODE_ID,
        type: "task",
        title: "Produce a visible json-render result",
        description: prompt,
        config: { expectedOutput },
        dependencies: [],
        dependents: [],
        mode: "auto",
        executor: "ai",
      },
    ],
    edges: [],
    entryNodeIds: [NODE_ID],
    terminalNodeIds: [NODE_ID],
    topologicalOrder: [NODE_ID],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

function requireCompletedResult(results: NodeResult[]): NodeResult {
  const result = results.find((entry) => entry.nodeId === NODE_ID && entry.status === "current");
  if (!result) throw new Error(`No current NodeResult found for ${NODE_ID}.`);
  if (!Array.isArray(result.outputs) || result.outputs.length === 0) {
    throw new Error("NodeResult.outputs is empty. Model completed without a prior chrona_node_output submission.");
  }
  return result;
}

function assertOutputBeforeComplete(actions: Array<{ kind: string; recordedAt: Date }>): void {
  const outputIndex = actions.findIndex((action) => action.kind === "output");
  const completeIndex = actions.findIndex((action) => action.kind === "complete");
  if (outputIndex < 0) throw new Error("No recorded output action. Expected chrona_node_output before completion.");
  if (completeIndex < 0) throw new Error("No recorded complete action. Expected chrona_node_complete after output.");
  if (outputIndex > completeIndex) throw new Error("chrona_node_complete was recorded before chrona_node_output.");
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  if (!trimmed) throw new Error("baseUrl is required for manual model test.");
  return trimmed;
}

function portFromBaseUrl(baseUrl: string): string | undefined {
  try {
    const url = new URL(baseUrl);
    return url.port || (url.protocol === "https:" ? "443" : "80");
  } catch {
    return undefined;
  }
}

async function assertClaudeCodeClient(clientId: string): Promise<void> {
  const client = await db.aiClient.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("AI client not found.");
  if (!client.enabled) throw new Error("AI client is disabled.");
  if (client.type !== RUNTIME_NAME) throw new Error("Manual node-output test requires a claude_code AI client.");
}

async function bindExecuteTaskNode(clientId: string): Promise<PreviousBinding> {
  const previous = await db.aiFeatureBinding.findUnique({ where: { feature: "execute_task_node" } });
  await db.aiFeatureBinding.upsert({
    where: { feature: "execute_task_node" },
    create: { feature: "execute_task_node", clientId },
    update: { clientId },
  });
  await aiClientRegistry.refresh();
  return previous ? { id: previous.id, feature: previous.feature, clientId: previous.clientId } : null;
}

async function restoreExecuteTaskNodeBinding(previous: PreviousBinding): Promise<void> {
  if (previous) {
    await db.aiFeatureBinding.upsert({
      where: { feature: previous.feature },
      create: { feature: previous.feature, clientId: previous.clientId },
      update: { clientId: previous.clientId },
    });
  } else {
    await db.aiFeatureBinding.deleteMany({ where: { feature: "execute_task_node" } });
  }
  await aiClientRegistry.refresh();
}


async function seedSchemaLabTask(input: { prompt?: string; expectedOutput?: string }): Promise<{ workspaceId: string; taskId: string; sessionId: string; plan: CompiledPlan }> {
  const planId = `manual_model_node_output_schema_lab_${Date.now().toString(36)}`;
  const workspace = await db.workspace.create({
    data: { name: `Manual schema lab ${new Date().toISOString()}`, status: "Active", defaultRuntime: RUNTIME_NAME },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Manual node-output schema lab",
      description: "Manual token-spending test for prompt/schema → model tool output validation.",
      status: TaskStatus.Ready,
      priority: TaskPriority.Medium,
      executionRuntime: RUNTIME_NAME,
      executionConfig: {},
    },
  });
  const plan = buildCompiledPlan(planId, input);
  const sessionId = buildPlanExecutionTaskSessionId({ taskId: task.id, planId: plan.editablePlanId });
  await saveCompiledPlan({
    workspaceId: workspace.id,
    taskId: task.id,
    compiledPlan: plan,
    status: "accepted",
    prompt: plan.nodes[0]?.description ?? plan.title,
    summary: plan.goal,
    generatedBy: "manual-node-output-schema-lab",
  });
  await savePlanRun({ workspaceId: workspace.id, taskId: task.id, planId: plan.editablePlanId, compiledPlan: plan });
  await db.taskSession.create({
    data: { taskId: task.id, runtimeName: RUNTIME_NAME, sessionId, label: "Node output schema lab" },
  });
  return { workspaceId: workspace.id, taskId: task.id, sessionId, plan };
}


function validateNodeOutputAttempt(input: unknown, result: unknown, index: number, callId: string | null): NodeOutputAttemptReport {
  const issues: string[] = [];
  let normalizedPayload: unknown = null;
  let contractValid = false;
  let runtimeValid = false;
  try {
    normalizedPayload = parseChronaToolPayload("chrona.node.output", input);
    contractValid = true;
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  if (contractValid) {
    const spec = (normalizedPayload as { spec?: unknown }).spec;
    const validation = validateChronaSpec(spec);
    runtimeValid = validation.ok;
    if (!validation.ok) {
      issues.push(...validation.issues.map((issue) => `${issue.path}: ${issue.message}`));
    }
  }
  return { index, callId, rawInput: input, toolResult: result, contractValid, runtimeValid, normalizedPayload, issues };
}

export function evaluateSchemaLabAttempts(attempts: NodeOutputAttemptReport[]): { passed: boolean; reportIssues: string[] } {
  const reportIssues: string[] = [];
  if (attempts.length !== 1) {
    reportIssues.push(`Expected exactly one chrona_node_output call, observed ${attempts.length}.`);
    if (attempts.length === 0) return { passed: false, reportIssues };
  }
  const attempt = attempts[0]!;
  if (!attempt.contractValid) reportIssues.push("chrona_node_output arguments failed contract validation.");
  if (!attempt.runtimeValid) reportIssues.push("chrona_node_output Spec failed runtime validation.");
  return { passed: attempts.length === 1 && attempt.contractValid && attempt.runtimeValid, reportIssues };
}

async function writeSchemaLabReport(input: Omit<ManualModelNodeOutputSchemaLabReport, "reportPath">): Promise<string> {
  await mkdir(RESULT_DIR, { recursive: true });
  const reportPath = join(RESULT_DIR, `${input.taskId}-schema-lab.json`);
  await writeFile(reportPath, JSON.stringify(input, null, 2));
  return reportPath;
}


async function seedTask(input: { prompt?: string; expectedOutput?: string }): Promise<{ workspaceId: string; taskId: string; plan: CompiledPlan }> {
  const planId = `manual_model_node_output_${Date.now().toString(36)}`;
  const workspace = await db.workspace.create({
    data: {
      name: `Manual LLM test ${new Date().toISOString()}`,
      status: "Active",
      defaultRuntime: RUNTIME_NAME,
    },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Manual LLM node output protocol test",
      description: "Manual token-spending test for prompt -> provider -> chrona_node_output -> chrona_node_complete.",
      status: TaskStatus.Ready,
      priority: TaskPriority.Medium,
      executionRuntime: RUNTIME_NAME,
      executionConfig: {},
    },
  });
  const plan = buildCompiledPlan(planId, input);
  await saveCompiledPlan({
    workspaceId: workspace.id,
    taskId: task.id,
    compiledPlan: plan,
    status: "accepted",
    prompt: plan.nodes[0]?.description ?? plan.title,
    summary: plan.goal,
    generatedBy: "manual-model-node-output-test",
  });
  return { workspaceId: workspace.id, taskId: task.id, plan };
}

async function writeReport(input: Omit<ManualModelNodeOutputTestReport, "reportPath">): Promise<string> {
  await mkdir(RESULT_DIR, { recursive: true });
  const reportPath = join(RESULT_DIR, `${input.taskId}.json`);
  await writeFile(reportPath, JSON.stringify(input, null, 2));
  return reportPath;
}

function installControlEnv(baseUrl: string): () => void {
  const priorBaseUrl = process.env.CHRONA_BASE_URL;
  const priorMcpBaseUrl = process.env.CHRONA_MCP_BASE_URL;
  const priorPort = process.env.PORT;
  process.env.CHRONA_BASE_URL = `${baseUrl}/api`;
  process.env.CHRONA_MCP_BASE_URL = baseUrl;
  const port = portFromBaseUrl(baseUrl);
  if (port) process.env.PORT = port;
  return () => {
    if (priorBaseUrl === undefined) delete process.env.CHRONA_BASE_URL;
    else process.env.CHRONA_BASE_URL = priorBaseUrl;
    if (priorMcpBaseUrl === undefined) delete process.env.CHRONA_MCP_BASE_URL;
    else process.env.CHRONA_MCP_BASE_URL = priorMcpBaseUrl;
    if (priorPort === undefined) delete process.env.PORT;
    else process.env.PORT = priorPort;
  };
}

async function cleanupWorkspace(workspaceId: string): Promise<void> {
  await db.workspace.delete({ where: { id: workspaceId } });
}

async function executeSeededTask(taskId: string): Promise<void> {
  const execution = await taskPlanExecution.dispatch({
    taskId,
    action: { action: "start_manual" },
  });
  if (execution.status !== "completed") {
    const message = "message" in execution && typeof execution.message === "string" ? execution.message : "";
    throw new Error(`Execution did not complete. status=${execution.status} message=${message}`);
  }
}

async function validatePersistedResult(taskId: string, planId: string): Promise<NodeResult> {
  const persisted = await getPlanRun(taskId, planId);
  if (!persisted) throw new Error("Plan run was not persisted.");
  const result = requireCompletedResult(persisted.results);
  const validation = validateChronaSpec(result.outputs?.[0]);
  if (!validation.ok) {
    throw new Error(`Persisted output is not a valid Chrona json-render Spec: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
  return result;
}

async function getTerminalActions(taskId: string) {
  const actions = await db.taskPlanTerminalAction.findMany({
    where: { taskId },
    orderBy: { recordedAt: "asc" },
    select: { kind: true, recordedAt: true },
  });
  assertOutputBeforeComplete(actions);
  return actions;
}

async function getRunIds(taskId: string): Promise<string[]> {
  const items = await db.taskTimelineItem.findMany({
    where: { taskId },
    orderBy: { sortTime: "asc" },
    select: { runId: true },
  });
  return [...new Set(items.map((item) => item.runId).filter((runId): runId is string => typeof runId === "string"))];
}

function getNodeReportFields(plan: CompiledPlan): { prompt: string; expectedOutput: string } {
  const firstNode = plan.nodes[0];
  const firstNodeConfig = firstNode.config as { expectedOutput?: unknown };
  return {
    prompt: firstNode.description ?? DEFAULT_NODE_PROMPT,
    expectedOutput:
      typeof firstNodeConfig.expectedOutput === "string" ? firstNodeConfig.expectedOutput : DEFAULT_EXPECTED_OUTPUT,
  };
}

async function buildReport(input: {
  baseUrl: string;
  workspaceId: string;
  taskId: string;
  plan: CompiledPlan;
  result: NodeResult;
}): Promise<ManualModelNodeOutputTestReport> {
  const actions = await getTerminalActions(input.taskId);
  const runIds = await getRunIds(input.taskId);
  const timeline = await getTimeline(input.taskId);
  const nodeReportFields = getNodeReportFields(input.plan);
  const output = input.result.outputs?.[0] ?? null;
  const reportWithoutPath = {
    passed: true as const,
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    planId: input.plan.editablePlanId,
    baseUrl: input.baseUrl,
    workspaceUrl: `${input.baseUrl}/en/tasks/${input.taskId}/workspace`,
    ...nodeReportFields,
    actionKinds: actions.map((action) => action.kind),
    runIds,
    outputSummary: input.result.outputSummary ?? null,
    outputCount: input.result.outputs?.length ?? 0,
    outputRoot: input.result.outputs?.[0]?.root ?? null,
    output,
    timeline,
  };
  const reportPath = await writeReport(reportWithoutPath);
  return { ...reportWithoutPath, reportPath };
}


function buildSchemaLabInstructions(input: { prompt: string; toolSchema: string }) {
  return [input.prompt, "Tool schema / validation contract under test:", input.toolSchema].join("\n\n");
}

export function buildManualModelNodeOutputSchemaLabDefaults(input: { taskInfo?: string } = {}) {
  const taskInfo = normalizeManualText(input.taskInfo, "Task: produce a concise Chrona task-node result UI. Include a title and two bullet/checklist items.");
  const nodeOutputTool = describeChronaNodeOutputPublicTool();
  return {
    taskInfo,
    prompt: buildSchemaLabRuntimePrompt({ taskInfo }),
    toolSchema: JSON.stringify(nodeOutputTool, null, 2),
    nodeOutputTool,
  };
}

function isNodeOutputTool(tool: string | undefined) {
  return tool === "chrona_node_output" || tool === "mcp__chrona__chrona_node_output";
}

export async function runManualModelNodeOutputSchemaLab(input: ManualModelNodeOutputSchemaLabInput): Promise<ManualModelNodeOutputSchemaLabReport> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  await assertClaudeCodeClient(input.clientId);
  const restoreEnv = installControlEnv(baseUrl);
  let workspaceId: string | null = null;

  try {
    const taskInfo = requireManualText(input.taskInfo, "taskInfo");
    const defaults = buildManualModelNodeOutputSchemaLabDefaults({ taskInfo });
    const prompt = normalizeManualText(input.prompt, defaults.prompt);
    const toolSchema = normalizeManualText(input.toolSchema, defaults.toolSchema);
    const seeded = await seedSchemaLabTask({ prompt: taskInfo, expectedOutput: taskInfo });
    workspaceId = seeded.workspaceId;
    const client = await aiClientRegistry.get(input.clientId);
    if (!client) throw new Error("AI client not found.");
    const provider = aiClientRegistry.requireProviderClient(client).providerClient;
    const instructions = buildSchemaLabInstructions({ prompt, toolSchema });
    const nodeOutputTool = defaults.nodeOutputTool;
    const ref = await provider.startRun({
      sessionId: seeded.sessionId,
      instructions,
      input: { type: "text", text: taskInfo },
      stream: true,
    });
    const calls: Array<{ callId: string | null; input: unknown; result: unknown }> = [];
    const textDeltas: string[] = [];
    const runIds = [ref.runId];
    for await (const event of provider.streamRun({ runId: ref.runId, sessionId: seeded.sessionId })) {
      if (event.type === "text_delta" && event.text.trim()) textDeltas.push(event.text);
      if (event.type === "tool_call" && isNodeOutputTool(event.tool)) {
        calls.push({ callId: event.callId, input: event.input, result: null });
      }
      if (event.type === "tool_result" && event.callId) {
        const call = calls.find((entry) => entry.callId === event.callId);
        if (call) call.result = event.result;
      }
    }
    const attempts = calls.map((call, index) => validateNodeOutputAttempt(call.input, call.result, index + 1, call.callId));
    const evaluation = evaluateSchemaLabAttempts(attempts);
    const reportWithoutPath = {
      passed: evaluation.passed,
      taskId: seeded.taskId,
      workspaceId: seeded.workspaceId,
      sessionId: seeded.sessionId,
      baseUrl,
      instructions,
      taskInfo,
      prompt,
      toolSchema,
      nodeOutputTool,
      runIds,
      toolCallCount: attempts.length,
      attempts,
      reportIssues: evaluation.reportIssues,
      textDeltas,
    };
    const reportPath = await writeSchemaLabReport(reportWithoutPath);
    return { ...reportWithoutPath, reportPath };
  } finally {
    restoreEnv();
    if (input.cleanup && workspaceId) await cleanupWorkspace(workspaceId);
  }
}

export async function runManualModelNodeOutputTest(input: ManualModelNodeOutputTestInput): Promise<ManualModelNodeOutputTestReport> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  await assertClaudeCodeClient(input.clientId);
  const restoreEnv = installControlEnv(baseUrl);
  const previousBinding = await bindExecuteTaskNode(input.clientId);
  let workspaceId: string | null = null;

  try {
    const seeded = await seedTask({ prompt: input.prompt, expectedOutput: input.expectedOutput });
    workspaceId = seeded.workspaceId;
    await executeSeededTask(seeded.taskId);
    const result = await validatePersistedResult(seeded.taskId, seeded.plan.editablePlanId);
    return await buildReport({
      baseUrl,
      workspaceId: seeded.workspaceId,
      taskId: seeded.taskId,
      plan: seeded.plan,
      result,
    });
  } finally {
    await restoreExecuteTaskNodeBinding(previousBinding);
    restoreEnv();
    if (input.cleanup && workspaceId) await cleanupWorkspace(workspaceId);
  }
}
