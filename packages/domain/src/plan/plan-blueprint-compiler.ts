import { randomUUID } from "node:crypto";

import type {
  CompiledPlan,
  LayerSource,
  PlanBlueprint,
  PlanBlueprintEdge,
} from "@chrona/contracts";
import {
  PlanCompileError,
  upgradeBlueprintToEditable,
} from "@chrona/contracts";
import { createLogger } from "@chrona/logging";
import { compileEditablePlan } from "./compile";

const logger = createLogger("domain.plan.blueprint-compiler");

const STABLE_NODE_ID = /^[a-z][a-z0-9_]*$/;

function compileIssue(path: string, message: string) {
  return { path, message };
}

function branchEdges(nodes: PlanBlueprint["nodes"]): PlanBlueprintEdge[] {
  const result: PlanBlueprintEdge[] = [];
  for (const node of nodes) {
    if (node.type !== "condition") continue;
    for (const branch of node.branches) {
      result.push({
        from: node.id,
        to: branch.nextNodeId,
        label: branch.label,
      });
    }
    if (node.defaultNextNodeId) {
      result.push({
        from: node.id,
        to: node.defaultNextNodeId,
        label: "default",
      });
    }
  }
  return result;
}

function assertDag(nodeIds: string[], edges: PlanBlueprintEdge[]) {
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map(nodeIds.map((id) => [id, [] as string[]]));
  for (const edge of edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const queue = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited += 1;
    for (const next of outgoing.get(current) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }

  return visited === nodeIds.length;
}

function validateBlueprint(input: { blueprint: PlanBlueprint }) {
  const issues: Array<{ path: string; message: string }> = [];
  const seenNodeIds = new Set<string>();

  input.blueprint.nodes.forEach((node, index) => {
    if (!STABLE_NODE_ID.test(node.id)) {
      issues.push(
        compileIssue(
          `nodes.${index}.id`,
          `Node id '${node.id}' must be snake_case`,
        ),
      );
    }
    if (seenNodeIds.has(node.id)) {
      issues.push(
        compileIssue(`nodes.${index}.id`, `Duplicate node id '${node.id}'`),
      );
    }
    seenNodeIds.add(node.id);
  });

  const nodeIds = input.blueprint.nodes.map((node) => node.id);
  const nodeIdSet = new Set(nodeIds);
  input.blueprint.edges.forEach((edge, index) => {
    if (!nodeIdSet.has(edge.from)) {
      issues.push(
        compileIssue(
          `edges.${index}.from`,
          `Unknown source node '${edge.from}'`,
        ),
      );
    }
    if (!nodeIdSet.has(edge.to)) {
      issues.push(
        compileIssue(`edges.${index}.to`, `Unknown target node '${edge.to}'`),
      );
    }
  });

  input.blueprint.nodes.forEach((node, index) => {
    if (node.type !== "condition") return;
    node.branches.forEach((branch, branchIndex) => {
      if (!nodeIdSet.has(branch.nextNodeId)) {
        issues.push(
          compileIssue(
            `nodes.${index}.branches.${branchIndex}.nextNodeId`,
            `Unknown branch target '${branch.nextNodeId}'`,
          ),
        );
      }
    });
    if (node.defaultNextNodeId && !nodeIdSet.has(node.defaultNextNodeId)) {
      issues.push(
        compileIssue(
          `nodes.${index}.defaultNextNodeId`,
          `Unknown default branch target '${node.defaultNextNodeId}'`,
        ),
      );
    }
  });

  const allEdges = [...input.blueprint.edges, ...branchEdges(input.blueprint.nodes)];

  if (issues.length === 0 && !assertDag(nodeIds, allEdges)) {
    issues.push(compileIssue("edges", "Plan graph must be a DAG"));
  }
  logger.debug("blueprint.validation_completed", { issueCount: issues.length, issues });

  if (issues.length > 0) {
    throw new PlanCompileError("Plan blueprint compilation failed", issues);
  }
}

/**
 * Compiles a loose AI blueprint (AIPlanOutput) into a CompiledPlan.
 */
export function compilePlanBlueprint(input: {
  taskId: string;
  blueprint: PlanBlueprint;
  planId?: string;
  generatedBy?: string | null;
  source?: LayerSource;
}): { compiledPlan: CompiledPlan; planId: string } {
  validateBlueprint({ blueprint: input.blueprint });

  const planId = input.planId ?? randomUUID().replaceAll("-", "").slice(0, 12);
  const editable = upgradeBlueprintToEditable(input.blueprint, planId, 1);
  const compiledPlan = compileEditablePlan(editable);

  return { compiledPlan, planId };
}
