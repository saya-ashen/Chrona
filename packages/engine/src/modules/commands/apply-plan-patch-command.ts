import { db } from "@/lib/db";
import {
  getLatestCompiledPlan,
  saveCompiledPlan,
  getEditablePlan,
} from "@/modules/plan-execution/compiled-plan-store";
import { savePlanRun } from "@/modules/plan-execution/plan-run-store";
import { createPlanRunFromCompiledPlan } from "@/modules/plan-execution/plan-run-bridge";
import { applyPlanPatch, compileEditablePlan } from "@chrona/domain";
import { upgradeBlueprintToEditable } from "@chrona/contracts/ai";
import type {
  EditablePlan,
  PlanPatch,
  PlanPatchOperation,
  EditableNode,
  EditableTaskNode,
  EditableEdge,
  StructuralLayer,
  PlanOverlayLayer,
} from "@chrona/contracts/ai";

export type PlanPatchInput = {
  taskId: string;
  operation: string;
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  nodePatches?: Array<{ id: string } & Record<string, unknown>>;
  deletedNodeIds?: string[];
  reorder?: string[];
  summary?: string;
};

function rawToTaskNode(raw: Record<string, unknown>, id: string): EditableTaskNode {
  return {
    id,
    type: "task",
    title: (typeof raw.title === "string" ? raw.title : id) as string,
    executor: (typeof raw.executionMode === "string" && raw.executionMode === "manual" ? "user" : "ai") as "ai" | "user",
    mode: (typeof raw.executionMode === "string" && raw.executionMode === "manual"
      ? "manual"
      : typeof raw.executionMode === "string" && raw.executionMode === "hybrid"
      ? "assist"
      : "auto") as "auto" | "assist" | "manual",
    ...(typeof raw.estimatedMinutes === "number" ? { estimatedMinutes: raw.estimatedMinutes } : {}),
    ...(typeof raw.objective === "string" ? { expectedOutput: raw.objective } : {}),
  };
}

function rawToEdge(raw: Record<string, unknown>, id: string): EditableEdge {
  return {
    from: raw.fromNodeId as string,
    to: raw.toNodeId as string,
  };
}

export async function applyPlanPatchCommand(input: PlanPatchInput) {
  const { taskId } = input;

  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error("Task not found");
  }

  // Load current editable plan
  let editablePlan = await getEditablePlan(taskId);
  const currentCompiled = await getLatestCompiledPlan(taskId);

  if (!editablePlan && !currentCompiled) {
    throw new Error("No plan found for this task");
  }

  // If we have a compiled plan but no editable plan, derive one from an empty blueprint
  if (!editablePlan) {
    editablePlan = upgradeBlueprintToEditable(
      { nodes: [{ id: "placeholder", type: "task", title: "Placeholder" }], edges: [], title: "Plan", goal: "" },
      currentCompiled!.compiledPlan.editablePlanId,
      1,
    );
  }

  // Build PlanPatch from command input
  const operations: PlanPatchOperation[] = [];
  const existingIds = new Set(editablePlan.nodes.map((n) => n.id));

  switch (input.operation) {
    case "add_node": {
      if (!input.nodes || input.nodes.length === 0) {
        throw new Error("add_node requires nodes[]");
      }
      for (let i = 0; i < input.nodes.length; i++) {
        const raw = input.nodes[i];
        const nodeId = typeof raw.id === "string" && raw.id.trim()
          ? raw.id
          : `node-${Date.now()}-${i}`;
        const node = rawToTaskNode(raw, nodeId);
        operations.push({ op: "add_node", node });
        if (input.edges && input.edges.length > 0) {
          for (const rawEdge of input.edges) {
            const fromId = rawEdge.fromNodeId as string;
            const toId = rawEdge.toNodeId as string;
            if (existingIds.has(fromId) || fromId === nodeId) {
              if (existingIds.has(toId) || toId === nodeId) {
                operations.push({ op: "add_edge", edge: { from: fromId, to: toId } });
              }
            }
          }
        }
      }
      break;
    }
    case "update_node": {
      if (!input.nodePatches || input.nodePatches.length === 0) {
        throw new Error("update_node requires nodePatches[]");
      }
      const unknownIds = input.nodePatches
        .map((p) => p.id)
        .filter((id) => !existingIds.has(id));
      if (unknownIds.length > 0) {
        throw new Error(`Unknown node id(s): ${unknownIds.join(", ")}`);
      }
      for (const p of input.nodePatches) {
        const patch: Record<string, unknown> = {};
        if (typeof p.title === "string") patch.title = p.title;
        if (typeof p.objective === "string") patch.expectedOutput = p.objective;
        if (typeof p.description === "string") patch.description = p.description;
        if (typeof p.estimatedMinutes === "number") patch.estimatedMinutes = p.estimatedMinutes;
        if (Object.keys(patch).length > 0) {
          operations.push({ op: "update_node", nodeId: p.id, patch: patch as unknown as EditableNode });
        }
      }
      break;
    }
    case "delete_node": {
      if (!input.deletedNodeIds || input.deletedNodeIds.length === 0) {
        throw new Error("delete_node requires deletedNodeIds[]");
      }
      for (const id of input.deletedNodeIds) {
        if (!existingIds.has(id)) {
          throw new Error(`Unknown node id: ${id}`);
        }
        operations.push({ op: "delete_node", nodeId: id });
      }
      break;
    }
    case "update_dependencies": {
      if (!input.edges || input.edges.length === 0) {
        throw new Error("update_dependencies requires edges[]");
      }
      // Replace all edges: delete old, add new
      for (const edge of editablePlan.edges) {
        operations.push({ op: "delete_edge", from: edge.from, to: edge.to });
      }
      for (const rawEdge of input.edges) {
        const fromId = rawEdge.fromNodeId as string;
        const toId = rawEdge.toNodeId as string;
        if (!existingIds.has(fromId) && !(input.nodes?.some((n) => n.id === fromId))) {
          throw new Error(`Unknown fromNodeId: ${fromId}`);
        }
        if (!existingIds.has(toId) && !(input.nodes?.some((n) => n.id === toId))) {
          throw new Error(`Unknown toNodeId: ${toId}`);
        }
        operations.push({ op: "add_edge", edge: { from: fromId, to: toId } });
      }
      break;
    }
    case "update_plan_summary": {
      if (input.summary !== undefined) {
        operations.push({ op: "update_plan", patch: { title: editablePlan.title, goal: input.summary } });
      }
      break;
    }
    default:
      throw new Error(`Unsupported plan operation: ${input.operation}`);
  }

  if (operations.length === 0) {
    return { taskId, operation: input.operation, compiledPlan: currentCompiled?.compiledPlan ?? null };
  }

  // Apply patch to editable plan (immutable)
  const patch: PlanPatch = {
    basePlanId: editablePlan.id,
    baseVersion: editablePlan.version,
    rationale: `Applied plan patch: ${input.operation}`,
    operations,
  };

  const result = applyPlanPatch(editablePlan, patch);
  if (!result.ok) {
    throw new Error(result.error ?? "Failed to apply plan patch");
  }

  // Recompile
  const newCompiledPlan = compileEditablePlan(result.plan!);

  // Save compiled plan
  await saveCompiledPlan({
    workspaceId: task.workspaceId,
    taskId,
    compiledPlan: newCompiledPlan,
    editablePlan: result.plan!,
    status: "draft",
    prompt: currentCompiled?.prompt ?? null,
    summary: result.plan!.goal ?? currentCompiled?.summary ?? null,
    generatedBy: currentCompiled?.generatedBy ?? null,
  });

  // Create structural layer + PlanRun
  const structuralLayer: StructuralLayer = {
    type: "structural",
    planId: newCompiledPlan.editablePlanId,
    timestamp: new Date().toISOString(),
    layerId: `struct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    active: true,
    source: "user",
    operations: operations.map((op) => {
      const structuralOp: Record<string, unknown> = { op: op.op };
      if ("nodeId" in op) structuralOp.nodeId = op.nodeId;
      if ("from" in op) structuralOp.from = op.from;
      if ("to" in op) structuralOp.to = op.to;
      if ("node" in op) structuralOp.data = op.node;
      if ("patch" in op) structuralOp.data = op.patch;
      if ("edge" in op) {
        structuralOp.from = op.edge.from;
        structuralOp.to = op.edge.to;
      }
      return structuralOp as never;
    }) as StructuralLayer["operations"],
  };

  // Create new run with structural layer
  const structuralLayers: PlanOverlayLayer[] = [structuralLayer];
  const run = createPlanRunFromCompiledPlan(newCompiledPlan, structuralLayers);
  await savePlanRun({
    workspaceId: task.workspaceId,
    taskId,
    planId: newCompiledPlan.editablePlanId,
    run,
    layers: structuralLayers,
  });

  return {
    taskId,
    operation: input.operation,
    compiledPlan: newCompiledPlan,
  };
}
