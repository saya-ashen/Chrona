import type { ExecutionActionInput, PlanExecutionResult, PlanOutputPatch, PlanOutputState } from "@chrona/contracts/ai";
import { getAcceptedCompiledPlanForTask } from "../persistence/execution-scope";
import { getCurrentExecution } from "./get-current-execution";
import { getPlanRun, savePlanRunGuarded } from "../persistence/plan-run-store";
import { appendMainSessionEvent, ensurePlanMainSession } from "../persistence/plan-state-store";
import { toEffectivePlanGraph } from "../projection/execution-graph-selectors";
import type { ExecutionDispatchContext } from "../types";
import type { ExecutionActionWithContinuation } from "../types";
import { dispatchExecutionAction } from "../task-plan-execution";
import { validateChronaSpec } from "@chrona/ui-protocol";
import { ENGINE_ERROR_CODES, EngineError } from "../../../errors";


function decodePointer(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new Error(`Invalid JSON Pointer path: ${path}`);
  return path.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function malformedRichMarkdownContent(value: unknown) {
  if (typeof value !== "string" || value.includes("\n")) return false;
  const literalBreaks = value.match(/\\n/g)?.length ?? 0;
  return literalBreaks >= 2
    && /\\n(?:[-*] |\d+[.)] |#{1,6} |> |```)/.test(value);
}

export function malformedPlanOutputMarkdownPath(spec: unknown): string | null {
  if (!isRecord(spec) || !isRecord(spec.elements)) return null;
  for (const [elementId, element] of Object.entries(spec.elements)) {
    if (!isRecord(element) || element.type !== "RichMarkdown") continue;
    const props = isRecord(element.props) ? element.props : null;
    if (props && malformedRichMarkdownContent(props.content)) {
      return `/elements/${elementId}/props/content`;
    }
  }
  return null;
}

function patchedElementKey(path: string) {
  const parts = decodePointer(path);
  return parts.length === 2 && parts[0] === "elements" && parts[1] ? parts[1] : null;
}

function stampPlanOutputElementSources(spec: Record<string, unknown>, nodeId: string, elementKeys: Set<string>) {
  const elements = spec.elements;
  if (!isRecord(elements)) return spec;
  for (const key of elementKeys) {
    const element = elements[key];
    if (!isRecord(element) || typeof element.type !== "string") continue;
    const props = isRecord(element.props) ? element.props : {};
    if (typeof props.xChronaSourceNodeId === "string" || typeof props.sourceNodeId === "string") continue;
    element.props = { ...props, xChronaSourceNodeId: nodeId };
  }
  return spec;
}


function parentAt(root: Record<string, unknown>, path: string): { parent: Record<string, unknown> | unknown[]; key: string } {
  const parts = decodePointer(path);
  if (parts.length === 0) throw new Error("Patch path must not target the document root");
  let parent: unknown = root;
  for (const part of parts.slice(0, -1)) {
    if (!parent || typeof parent !== "object") throw new Error(`Patch parent does not exist: ${path}`);
    parent = (parent as Record<string, unknown>)[part];
  }
  if (!parent || typeof parent !== "object") throw new Error(`Patch parent does not exist: ${path}`);
  return { parent: parent as Record<string, unknown> | unknown[], key: parts[parts.length - 1]! };
}

function valueAt(root: Record<string, unknown>, path: string): unknown {
  let value: unknown = root;
  for (const part of decodePointer(path)) {
    if (!value || typeof value !== "object") throw new Error(`Patch source does not exist: ${path}`);
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function writeValue(target: Record<string, unknown>, path: string, value: unknown, replace: boolean) {
  const parts = decodePointer(path);
  if (!replace && parts.length === 1 && !(parts[0]! in target)) {
    target[parts[0]!] = cloneJson(value);
    return;
  }
  const { parent, key } = parentAt(target, path);
  if (Array.isArray(parent)) {
    const index = key === "-" ? parent.length : Number(key);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) throw new Error(`Invalid array patch path: ${path}`);
    if (replace) {
      if (index >= parent.length) throw new Error(`Replace path does not exist: ${path}`);
      parent[index] = value;
    } else {
      parent.splice(index, 0, value);
    }
    return;
  }
  if (replace && !(key in parent)) throw new Error(`Replace path does not exist: ${path}`);
  parent[key] = value;
}

function removeValue(target: Record<string, unknown>, path: string) {
  const { parent, key } = parentAt(target, path);
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) throw new Error(`Remove path does not exist: ${path}`);
    parent.splice(index, 1);
    return;
  }
  if (!(key in parent)) throw new Error(`Remove path does not exist: ${path}`);
  delete parent[key];
}

function applyPlanOutputPatches(current: unknown, patches: PlanOutputPatch[], sourceNodeId?: string): unknown {
  const target = cloneJson((current ?? { elements: {} }) as Record<string, unknown>);
  const patchedElementKeys = new Set<string>();
  for (const patch of patches) {
    switch (patch.op) {
      case "add":
        writeValue(target, patch.path, cloneJson(patch.value), false);
        break;
      case "replace":
        writeValue(target, patch.path, cloneJson(patch.value), true);
        break;
      case "remove":
        removeValue(target, patch.path);
        break;
      case "copy":
        writeValue(target, patch.path, cloneJson(valueAt(target, patch.from)), false);
        break;
      case "move": {
        const value = cloneJson(valueAt(target, patch.from));
        removeValue(target, patch.from);
        writeValue(target, patch.path, value, false);
        break;
      }
      case "test":
        if (JSON.stringify(valueAt(target, patch.path)) !== JSON.stringify(patch.value)) throw new Error(`Patch test failed: ${patch.path}`);
        break;
    }
    const key = patch.op === "remove" || patch.op === "test" ? null : patchedElementKey(patch.path);
    if (key) patchedElementKeys.add(key);
  }
  return sourceNodeId ? stampPlanOutputElementSources(target, sourceNodeId, patchedElementKeys) : target;
}

function outputNodeFromEffective(input: {
  effective: ReturnType<typeof toEffectivePlanGraph>;
  nodeId?: string;
}) {
  if (input.nodeId) {
    const node = input.effective.nodes.find((candidate) => candidate.id === input.nodeId);
    if (!node) throw new Error("nodeId does not resolve to a node in the current execution graph");
    return node;
  }
  const node = input.effective.nodes.find((candidate) => candidate.status === "running")
    ?? input.effective.nodes.find((candidate) => input.effective.readyNodeIds.includes(candidate.id));
  if (!node) throw new Error("No active node is available for output submission");
  return node;
}

async function updatePlanOutput(input: {
  taskId: string;
  commandContext?: ExecutionDispatchContext;
  action: Extract<ExecutionActionInput, { action: "update_plan_output" }>;
}): Promise<PlanExecutionResult> {
  const accepted = await getAcceptedCompiledPlanForTask(input.taskId, {
    sessionId: input.action.sessionId,
  });
  if (!accepted)
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      "No accepted plan. Create or accept a plan before updating plan output.",
    );
  const persisted = await getPlanRun(input.taskId, accepted.compiledPlan.editablePlanId, accepted.workBlockId);
  if (!persisted?.graph) throw new Error("No runtime graph is available for output submission");
  const effective = toEffectivePlanGraph({
    graph: persisted.graph,
    attempts: persisted.attempts,
    results: persisted.results,
  });
  const node = outputNodeFromEffective({ effective, nodeId: input.action.nodeId });
  const nextSpec = applyPlanOutputPatches(persisted.planOutput.spec, input.action.patches, node.id);
  const malformedMarkdownPath = malformedPlanOutputMarkdownPath(nextSpec);
  if (malformedMarkdownPath) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      `Invalid chrona_plan_output RichMarkdown at ${malformedMarkdownPath}: use actual newline characters instead of pre-escaped literal \\n text.`,
    );
  }
  const validation = validateChronaSpec(nextSpec);
  if (!validation.ok) {
    throw new EngineError(
      ENGINE_ERROR_CODES.VALIDATION_FAILED,
      `Invalid chrona_plan_output json-render Spec patches: ${validation.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
  }
  const now = new Date().toISOString();
  const planOutput: PlanOutputState = {
    spec: validation.spec as PlanOutputState["spec"],
    revision: persisted.planOutput.revision + 1,
    updatedAt: now,
    updatedByNodeId: node.id,
    history: [
      ...persisted.planOutput.history,
      {
        id: `plan_output_${persisted.graph.id}_${persisted.planOutput.revision + 1}_${Date.now()}`,
        nodeId: node.id,
        nodeLayerId: node.activeLayerId,
        sessionId: input.action.sessionId,
        summary: input.action.summary,
        patches: input.action.patches,
        createdAt: now,
      },
    ],
  };
  const saved = await savePlanRunGuarded({
    workspaceId: accepted.workspaceId,
    taskId: input.taskId,
    planId: accepted.compiledPlan.editablePlanId,
    workBlockId: accepted.workBlockId,
    expectedEpoch: persisted.executionEpoch,
    run: persisted.planRun,
    compiledPlan: accepted.compiledPlan,
    graph: persisted.graph,
    attempts: persisted.attempts,
    results: persisted.results,
    executionContextSnapshots: persisted.executionContextSnapshots,
    planOutput,
  });
  if (!saved.committed) throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Plan output changed concurrently. Retry with latest output.");
  const mainSession = input.action.sessionId
    ? { id: input.action.sessionId }
    : await ensurePlanMainSession({ taskId: input.taskId, planId: accepted.compiledPlan.editablePlanId });
  await appendMainSessionEvent({
    taskId: input.taskId,
    planId: accepted.compiledPlan.editablePlanId,
    sessionId: mainSession.id,
    eventType: "plan_output_updated",
    payload: {
      nodeId: node.id,
      patchCount: input.action.patches.length,
      revision: planOutput.revision,
      summary: input.action.summary,
    },
  });
  return getCurrentExecution({ taskId: input.taskId, workBlockId: accepted.workBlockId });
}

/**
 * Terminal node submission. update_plan_output patches the shared plan-level
 * json-render document; terminal kinds flow through the kernel via
 * dispatchExecutionAction and continue serially when appropriate.
 */
export async function submitTerminalNodeResult(input: {
  taskId: string;
  commandContext?: ExecutionDispatchContext;
  action: Extract<ExecutionActionInput, {
    action: "update_plan_output" | "complete_manual_node" | "block_current_node" | "fail_current_node";
  }>;
}): Promise<PlanExecutionResult> {
  if (input.action.action === "update_plan_output") {
    return updatePlanOutput(input as {
      taskId: string;
      commandContext?: ExecutionDispatchContext;
      action: Extract<ExecutionActionInput, { action: "update_plan_output" }>;
    });
  }

  return dispatchExecutionAction({
    taskId: input.taskId,
    action: input.action.action === "complete_manual_node"
      ? ({ ...input.action, continueExecution: false } satisfies ExecutionActionWithContinuation)
      : input.action,
    commandContext: input.commandContext,
  });
}
