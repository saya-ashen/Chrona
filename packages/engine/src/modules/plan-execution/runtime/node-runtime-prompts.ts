import type {
	CheckpointInputFields,
	EffectivePlanGraph,
	EffectivePlanNode,
	NodeRuntimeInput,
	PlanOutputState,
} from "@chrona/contracts/ai";

import { buildNodeRuntimeInput } from "./node-runtime-refs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getChronaGeneratedFilesDir } from "@chrona/shared/data-paths";

export const NODE_RUNTIME_TERMINAL_TOOLS = {
	task: [
		"chrona_node_complete",
		"chrona_node_request_input",
		"chrona_node_block",
		"chrona_node_fail",
	],
	condition: [
		"chrona_condition_select",
		"chrona_node_block",
		"chrona_node_fail",
	],
	checkpoint: [
		"chrona_node_request_input",
		"chrona_node_block",
		"chrona_node_fail",
	],
	wait: ["chrona_wait_complete", "chrona_node_block", "chrona_node_fail"],
} as const;

const NODE_RUNTIME_PROTOCOL = `
You are Chrona's node runtime worker.
Chrona backend owns real task, plan, graph, node, and layer IDs.
Use only AI-visible refs from runtime input: node.ref and branchOptions[].ref.
You must never invent or emit backend IDs.
This is a semantic work and artifact phase, not a presentation phase: never create, patch, or mutate Chrona/json-render UI, never emit UI operation patches such as op:add, op:replace, or op:remove, and never spend node time arranging cards, sections, or result layout. The engine-owned result finalizer is the only phase that creates the final UI after the execution graph completes.
Do not call chrona_node_read or chrona_execution_read by default.
When a relevantPreviousResults summary lacks exact facts required by the current objective, call chrona_node_read with that entry's nodeRef. The tool returns bounded semantic result JSON; continue with offset when nextOffset is present. Also call chrona_node_read when current node details, result submission actions, or branch refs are missing, ambiguous, or suspected stale.
Call chrona_execution_read only after a Chrona result submission action is rejected/errors, or when overall execution status/recovery actions are needed.
Use context.plan.goal and context.plan.assumptions as the global objective and constraints for the current node. If context.goal is present, it is the Task's frozen Goal snapshot: use its additionalContext and operationalBrief before requesting information the user already supplied. context.goalAssets is the complete metadata-only catalog captured when this Task was created. Select assets relevant to the current node's objective, dependencies, and deliverable; never infer body facts from title or description, and never traverse the entire catalog indiscriminately. Call chrona_goal_results_read with an exact opaque ref only when body content can materially affect the current node. Reads always resolve the captured formal version, not the live latest version. If context.acceptedGoalResults is present, treat those entries as bounded summaries with opaque refs and call chrona_goal_results_read with ref when more detail is required; neither catalog grants access to undeclared files. context.resultManifest lists semantic keys already contributed by earlier nodes. If context.run is present, treat it as initial run-level planning context and do not repeat it in node outputs.
Call chrona_node_request_input only for genuine business input that Chrona does not already own, after using the supplied plan, Goal, prior-result refs, and current-node context. Never ask the user to re-enter a result already produced by an earlier node. If a required Chrona-owned prior result cannot be recovered through chrona_node_read, call chrona_node_block with that infrastructure recovery failure. Keep chrona_node_block for exceptional external blockers such as missing access or unavailable capability. A request-input form uses only text, choice, and boolean field kinds; choice.selection distinguishes single from multiple selection.
After chrona_node_complete, chrona_condition_select, chrona_wait_complete, chrona_node_request_input, chrona_node_block, or chrona_node_fail succeeds, stop immediately. Do not continue downstream nodes.
`.trim();

function resultArtifactGuidance(runtimeInput: NodeRuntimeInput): string {
	const generatedFiles = runtimeInput.context.run?.generatedFiles;
	if (!generatedFiles) return "";
	return `For generated result artifacts not explicitly requested as repo/code changes, write only under the absolute output directory ${generatedFiles.directory}. Declare each file in chrona_node_complete.deliverables using a stable deliverableKey and ${generatedFiles.referenceBase}<filename>. Submit concise semantic findings, decisions, caveats, nextActions, and evidenceItems in the same terminal call. Do not build UI, generate download URLs, use .. segments, expose secrets/tokens/backend IDs, or reference paths outside the assigned output directory.`;
}

function generatedFilesContext(nodeRef: string) {
	const scope = new Date().toISOString().slice(0, 10).replaceAll("-", "");
	const directory = join(getChronaGeneratedFilesDir(), scope, nodeRef);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	return {
		directory,
		referenceBase: `generated://${scope}/${nodeRef}/`,
	};
}

function nodeTypeInstructions(node: EffectivePlanNode): string {
	switch (node.type) {
		case "task":
			return `Complete the node objective, then call chrona_node_complete once with a concise summary and semantic result contributions. Use stable keys that describe meaning rather than execution order. Declare every user-visible generated file through deliverables; Chrona registers files and organizes the final result after the execution graph completes. Do not create or patch json-render UI. Do not duplicate existing keys from context.resultManifest unless this node intentionally replaces that logical deliverable. If the objective requires filesystem, shell, browser, network, or code execution capability you do not have, block instead of pretending completion.`;
		case "condition":
			return `Evaluate exactly one listed branch and call chrona_condition_select with branchRef. Do not use labels, nextNodeId, default branches, natural-language conclusions, or incomplete JSON as routing authority. If no explicit branchRef is safe, call chrona_node_block.`;
		case "checkpoint": {
			const config = node.config as {
				required?: boolean;
				interaction?: { schemaSource?: string; instruction?: string };
			};
			if (config.interaction?.schemaSource === "ai") {
				return `This is a required AI-defined human interaction gate. Use prior execution context and results to decide the concrete question, field kinds, choices, recommendations, and defaults. You MUST call chrona_node_request_input with a concise validated form; do not call chrona_node_complete and do not substitute chrona_node_block. Planning instruction: ${config.interaction.instruction ?? node.title}`;
			}
			return `Review only the current checkpoint context. Do not submit checkpoint decisions: Checkpoint submission is performed by the user in the frontend. Call chrona_node_request_input when structured user input is required, chrona_node_block only for an exceptional external blocker, and chrona_node_fail only for unrecoverable errors.`;
		}
		case "wait":
			return `Complete only when the wait condition is satisfied by explicit evidence. Otherwise block or fail with a concise reason.`;
	}
}

function runtimeJson(runtimeInput: NodeRuntimeInput): string {
	return JSON.stringify(runtimeInput, null, 2);
}

export function buildNodeRuntimePrompt(input: {
	plan: EffectivePlanGraph;
	node: EffectivePlanNode;
	planOutput?: PlanOutputState | NodeRuntimeInput["context"]["resultManifest"];
	planContext?: NodeRuntimeInput["context"]["plan"];
	runContext?: NonNullable<NodeRuntimeInput["context"]["run"]>;
	userInput?: string;
	inputFields?: CheckpointInputFields;
}): { instructions: string; runtimeInput: NodeRuntimeInput } {
	const currentNodeResultActionNames = [
		...NODE_RUNTIME_TERMINAL_TOOLS[input.node.type],
	];
	const baseRuntimeInput = buildNodeRuntimeInput({
		plan: input.plan,
		node: input.node,
		planOutput: input.planOutput,
		planContext: input.planContext,
		runContext: input.runContext,
		userInput: input.userInput,
		inputFields: input.inputFields,
	});
	const runtimeInput: NodeRuntimeInput =
		input.node.type === "task"
			? {
					...baseRuntimeInput,
					context: {
						...baseRuntimeInput.context,
						run: {
							...baseRuntimeInput.context.run,
							generatedFiles: generatedFilesContext(baseRuntimeInput.node.ref),
						},
					},
				}
			: baseRuntimeInput;

	const catalogSection =
		input.node.type === "task" ? [resultArtifactGuidance(runtimeInput)] : [];

	const instructions = [
		NODE_RUNTIME_PROTOCOL,
		nodeTypeInstructions(input.node),
		`Finish with one terminal Chrona action: ${currentNodeResultActionNames.join(", ")}. Task completion carries semantic result contributions and declared deliverables; Chrona owns artifact registration and final presentation.`,
		...catalogSection,
		"Current Node Context JSON:",
		runtimeJson(runtimeInput),
	].join("\n\n");
	return { instructions, runtimeInput };
}
