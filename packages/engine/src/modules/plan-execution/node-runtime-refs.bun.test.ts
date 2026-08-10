import { describe, expect, it } from "bun:test";
import type {
	EffectivePlanGraph,
	EffectivePlanNode,
} from "@chrona/contracts/ai";
import {
	branchBindingForRef,
	buildNodeRuntimeInput,
	buildSemanticRefHistory,
} from "./runtime/node-runtime-refs";
import { buildNodeRuntimePrompt } from "./runtime/node-runtime-prompts";

function node(
	input: Partial<EffectivePlanNode> &
		Pick<EffectivePlanNode, "id" | "title" | "type">,
): EffectivePlanNode {
	return {
		nodeId: input.nodeId ?? input.id,
		activeLayerId: input.activeLayerId ?? `${input.id}-layer`,
		semanticKey: input.semanticKey ?? input.id,
		localId: input.localId ?? input.id,
		description: input.description ?? null,
		status: input.status ?? "pending",
		result: input.result ?? null,
		config: input.config ?? {},
		definition: input.definition ?? { title: input.title, type: input.type },
		dependencies: input.dependencies ?? [],
		dependents: input.dependents ?? [],
		...input,
	} as EffectivePlanNode;
}

function graph(nodes: EffectivePlanNode[]): EffectivePlanGraph {
	return {
		graphId: "graph-real-123",
		planId: "plan-real-123",
		basePlanId: "task-real-123",
		resolvedVersion: 1,
		resolvedAt: "2026-05-16T00:00:00.000Z",
		nodes,
		edges: [],
		entryNodeIds: [nodes[0]?.id ?? ""],
		terminalNodeIds: [nodes.at(-1)?.id ?? ""],
		readyNodeIds: [],
		blockedNodeIds: [],
		completedNodeIds: [],
		runningNodeIds: [],
		failedNodeIds: [],
		invalidatedNodeIds: [],
		pendingNodeIds: nodes.map((item) => item.id),
	} as unknown as EffectivePlanGraph;
}

describe("node runtime refs", () => {
	it("builds slim deterministic public refs without backend IDs in runtime input", () => {
		const condition = node({
			id: "condition-real-123",
			title: "Choose path",
			type: "condition",
			config: {
				condition: "Is approved?",
				evaluationBy: "ai",
				branches: [{ label: "yes", nextNodeId: "task-real-456" }],
			},
		});
		const plan = graph([
			condition,
			node({ id: "task-real-456", title: "Do work", type: "task" }),
		]);

		const input = buildNodeRuntimeInput({
			plan,
			node: condition,
		});
		const serialized = JSON.stringify(input);

		expect(input.node.ref).toBe("N20260516-01");
		expect(input.context.relevantPreviousResults).toEqual([]);
		expect(input.branchOptions).toEqual([
			{ ref: "B20260516-01-A", key: "A", label: "yes" },
		]);
		expect(serialized).not.toContain("task-real-123");
		expect(serialized).not.toContain("graph-real-123");
		expect(serialized).not.toContain("condition-real-123");
		expect(serialized).not.toContain("task-real-456");
		expect(serialized).not.toContain("nextNodeId");
		expect(serialized).not.toContain("taskRef");
		expect(serialized).not.toContain("planRef");
		expect(serialized).not.toContain("allowedTerminalTools");
		expect(serialized).not.toContain("currentNodeAvailableTools");
		expect(serialized).not.toContain("currentNodeAvailableToolNames");
		expect(serialized).not.toContain("terminalActionToolNames");
		expect(serialized).not.toContain("terminalActions");
		expect(serialized).not.toContain("availableToolNames");
		expect(serialized).not.toContain("availableTools");
		expect(serialized).not.toContain('"terminal"');
		expect(serialized).not.toContain('"tools"');
		expect(serialized).not.toContain('"names"');
		expect(serialized).not.toContain("previousResults");
		expect(serialized).not.toContain("status");
		expect(serialized).not.toContain("config");
	});

	it("includes only direct dependency results plus compact global summary", () => {
		const dependency = node({
			id: "dependency-real-123",
			title: "Confirm requirements",
			type: "task",
			status: "completed",
			result: {
				nodeId: "dependency-real-123",
				status: "completed",
				outputSummary: "Weather script requirements confirmed.",
				inputFields: {
					channels: ["official", "euraxess"],
					includeRolling: true,
				},
			} as unknown as EffectivePlanNode["result"],
		});
		const unrelated = node({
			id: "unrelated-real-123",
			title: "Prepare workspace",
			type: "task",
			status: "completed",
			result: {
				nodeId: "unrelated-real-123",
				status: "completed",
				outputSummary: "Workspace is ready.",
			} as unknown as EffectivePlanNode["result"],
		});
		const current = node({
			id: "task-real-456",
			title: "Write script spec",
			type: "task",
			dependencies: [dependency.id],
			config: {
				expectedOutput: "A weather script spec.",
				completionCriteria: "Inputs, outputs, and dependencies are clear.",
			},
		});
		const input = buildNodeRuntimeInput({
			plan: graph([dependency, unrelated, current]),
			node: current,
		});

		expect(input.node).toMatchObject({
			ref: "N20260516-03",
			type: "task",
			title: "Write script spec",
			expectedOutput: "A weather script spec.",
			completionCriteria: "Inputs, outputs, and dependencies are clear.",
		});
		expect(input.context.relevantPreviousResults).toEqual([
			{
				nodeRef: "N20260516-01",
				title: "Confirm requirements",
				summary: "Weather script requirements confirmed.",
				inputFields: {
					channels: ["official", "euraxess"],
					includeRolling: true,
				},
			},
		]);
		expect(input.context.globalSummary).toBe(
			"Prepare workspace: Workspace is ready.",
		);
		expect(input.branchOptions).toBeUndefined();
	});

	it("includes plan brief and only explicit initial run context", () => {
		const current = node({
			id: "task-real-456",
			title: "Write script spec",
			type: "task",
		});
		const plan = graph([current]);

		const firstInput = buildNodeRuntimeInput({
			plan,
			node: current,
			planContext: {
				title: "Weather agent plan",
				goal: "Create a weather automation agent.",
				assumptions: ["Use available public weather APIs."],
				summary: "Build and verify the agent.",
			},
			runContext: {
				planningPrompt: "Original user planning request",
				startPrompt: "Start now",
			},
		});
		const nextInput = buildNodeRuntimeInput({
			plan,
			node: current,
			planContext: {
				title: "Weather agent plan",
				goal: "Create a weather automation agent.",
				assumptions: ["Use available public weather APIs."],
				summary: "Build and verify the agent.",
			},
		});

		expect(firstInput.context.plan).toEqual({
			title: "Weather agent plan",
			goal: "Create a weather automation agent.",
			assumptions: ["Use available public weather APIs."],
			summary: "Build and verify the agent.",
		});
		expect(firstInput.context.run).toEqual({
			planningPrompt: "Original user planning request",
			startPrompt: "Start now",
		});
		expect(nextInput.context.plan.goal).toBe(
			"Create a weather automation agent.",
		);
		expect(nextInput.context.run).toBeUndefined();
	});

	it("projects the frozen Goal snapshot without exposing backend identifiers", () => {
		const current = node({
			id: "task-real-goal-context",
			title: "Build candidate profile",
			type: "task",
		});
		const plan = graph([current]);

		const input = buildNodeRuntimeInput({
			plan,
			node: current,
			planContext: {
				title: "PhD search plan",
				goal: "Find relevant AI Agent PhD positions.",
				assumptions: [],
				goalContext: {
					goal: {
						title: "Apply for an AI Agent PhD",
						additionalContext:
							"Bioinformatics graduate student; research focus: AI, Agent, LLM.",
						operationalBrief: {
							outcome: "Apply for an AI Agent PhD",
							currentFocus: "Find positions",
							strategy: "",
							constraints: ["Fully funded"],
						},
						capturedAt: "2026-07-25T12:25:05.730Z",
					},
					acceptedResults: [
						{
							ref: "GRABCDEF123456",
							taskTitle: "Previous research",
							acceptedAt: "2026-07-24T10:00:00.000Z",
							summary: "Candidate prefers LLM agents and tool use.",
							artifactCount: 1,
						},
					],
					assets: [
						{
							ref: "GA123456ABCDEF",
							title: "Current guide",
							description: "Current approved guide",
							kind: "document",
							role: "working_document",
							version: 2,
							updatedAt: "2026-07-25T11:00:00.000Z",
						},
					],
				},
			},
		});

		expect(input.context.goal).toEqual({
			title: "Apply for an AI Agent PhD",
			additionalContext:
				"Bioinformatics graduate student; research focus: AI, Agent, LLM.",
			operationalBrief: {
				outcome: "Apply for an AI Agent PhD",
				currentFocus: "Find positions",
				strategy: "",
				constraints: ["Fully funded"],
			},
			capturedAt: "2026-07-25T12:25:05.730Z",
		});
		expect(input.context.acceptedGoalResults).toEqual([
			{
				ref: "GRABCDEF123456",
				taskTitle: "Previous research",
				acceptedAt: "2026-07-24T10:00:00.000Z",
				summary: "Candidate prefers LLM agents and tool use.",
				artifactCount: 1,
			},
		]);
		expect(input.context.goalAssets).toEqual([
			{
				ref: "GA123456ABCDEF",
				title: "Current guide",
				description: "Current approved guide",
				kind: "document",
				role: "working_document",
				version: 2,
				updatedAt: "2026-07-25T11:00:00.000Z",
			},
		]);
		expect(JSON.stringify(input)).not.toContain("task-real-goal-context");
	});

	it("resolves only exact branch refs scoped to the current condition node", () => {
		const condition = node({
			id: "condition-real-123",
			title: "Choose path",
			type: "condition",
			config: {
				condition: "Is approved?",
				evaluationBy: "ai",
				branches: [{ label: "yes", nextNodeId: "task-real-456" }],
			},
		});
		const otherCondition = node({
			id: "condition-real-999",
			title: "Other path",
			type: "condition",
			config: {
				condition: "Other?",
				evaluationBy: "ai",
				branches: [{ label: "no", nextNodeId: "task-real-456" }],
			},
		});
		const plan = graph([
			condition,
			node({ id: "task-real-456", title: "Do work", type: "task" }),
			otherCondition,
		]);

		const binding = branchBindingForRef({
			plan,
			node: condition,
			branchRef: "B20260516-01-A",
		});
		expect(binding.nextNodeId).toBe("task-real-456");
		expect(() =>
			branchBindingForRef({
				plan,
				node: otherCondition,
				branchRef: "B20260516-01-A",
			}),
		).toThrow("branchRef");
		expect(() =>
			branchBindingForRef({ plan, node: condition, branchRef: "yes" }),
		).toThrow("branchRef");
	});

	it("keeps backend bindings private while prompts forbid real ID generation", () => {
		const current = node({
			id: "task-real-123",
			title: "Do work",
			type: "task",
		});
		const plan = graph([current]);
		const history = buildSemanticRefHistory(plan);
		const runtime = buildNodeRuntimePrompt({ plan, node: current });

		expect(history.nodeRefs[0]?.backendId).toBe("task-real-123");
		expect(JSON.stringify(runtime.runtimeInput)).not.toContain("task-real-123");
		expect(runtime.instructions).not.toContain(
			"Chrona tools available for the current node",
		);
		expect(runtime.instructions).not.toContain("current-node available tools");
		expect(runtime.instructions).not.toContain("available tools");
		expect(runtime.instructions).not.toContain("terminal MCP tool");
		expect(runtime.instructions).not.toContain("Allowed Chrona terminal tools");
		expect(runtime.instructions).toContain(
			"Do not call chrona_node_read or chrona_execution_read by default",
		);
		expect(runtime.instructions).toContain("Call chrona_node_read only when");
		expect(runtime.instructions).toContain(
			"Call chrona_execution_read only after",
		);
		expect(runtime.instructions).toContain(
			"complete metadata-only catalog captured when this Task was created",
		);
		expect(runtime.instructions).toContain(
			"never traverse the entire catalog indiscriminately",
		);
		expect(runtime.instructions).toContain(
			"captured formal version, not the live latest version",
		);
	});

	it("prompts task nodes to submit semantic results", () => {
		const current = node({
			id: "task-real-789",
			title: "Research result",
			type: "task",
			description: "Create a semantic result.",
		});
		const plan = graph([current]);
		const runtime = buildNodeRuntimePrompt({ plan, node: current });

		expect(runtime.instructions).toContain("chrona_node_complete");
		expect(runtime.instructions).toContain(
			"Declare every user-visible generated file through deliverables",
		);
		expect(runtime.instructions).toContain("findings");
		expect(runtime.instructions).toContain(
			"This is a semantic work and artifact phase, not a presentation phase",
		);
		expect(runtime.instructions).toContain("op:add");
		expect(runtime.instructions).toContain(
			"engine-owned result finalizer is the only phase that creates the final UI",
		);
		expect(runtime.instructions).not.toContain("RFC 6902");
		expect(runtime.instructions).not.toContain("chrona_plan_output");
		expect(runtime.runtimeInput.context.resultManifest).toEqual({
			sourceRevision: 0,
			outcome: {
				title: "Result pending",
				summary: "No node result has been submitted.",
			},
			currentDeliverableKeys: [],
			findingKeys: [],
			decisionKeys: [],
			caveatKeys: [],
			nextActionKeys: [],
		});
		expect(runtime.runtimeInput.context.run?.generatedFiles).toEqual({
			directory: expect.stringMatching(/\/generated\/\d{8}\/N20260516-01$/),
			referenceBase: expect.stringMatching(
				/^generated:\/\/\d{8}\/N20260516-01\/$/,
			),
		});
		expect(runtime.instructions).toContain("absolute output directory");
		const generatedReference =
			runtime.runtimeInput.context.run?.generatedFiles?.referenceBase;
		expect(generatedReference).toBeDefined();
		expect(runtime.instructions).toContain(generatedReference!);
	});

	it("passes the accumulated semantic manifest into task prompts", () => {
		const current = node({
			id: "task-real-790",
			title: "Continue result",
			type: "task",
			description: "Continue from prior findings.",
		});
		const plan = graph([current]);
		const planOutput = {
			manifest: {
				schemaVersion: 1 as const,
				sourceRevision: 1,
				outcome: { title: "Research", summary: "First section complete" },
				readiness: { status: "partial" as const, summary: "More work remains" },
				sections: [],
				deliverables: [],
				findings: [
					{
						key: "first-finding",
						content: "First finding",
						sourceNodeRef: "N20260516-01",
					},
				],
				decisions: [],
				caveats: [],
				nextActions: [],
				evidence: [],
			},
			finalizedResult: null,
			finalization: { status: "Pending" as const, sourceRevision: 1 },
			revision: 1,
			updatedAt: "2026-05-16T00:01:00.000Z",
			updatedByNodeId: "first-task",
		};

		const runtime = buildNodeRuntimePrompt({ plan, node: current, planOutput });

		expect(runtime.runtimeInput.context.resultManifest).toEqual({
			sourceRevision: 1,
			outcome: { title: "Research", summary: "First section complete" },
			currentDeliverableKeys: [],
			findingKeys: ["first-finding"],
			decisionKeys: [],
			caveatKeys: [],
			nextActionKeys: [],
		});
		expect(runtime.instructions).toContain('"sourceRevision": 1');
		expect(runtime.instructions).toContain('"findingKeys": [');
		expect(runtime.instructions).not.toContain('"spec":');
	});
	it("includes typed current-node input when resuming the same AI node", () => {
		const current = node({
			id: "task-real-456",
			title: "Assemble application package",
			type: "task",
		});
		const plan = graph([current]);
		const runtime = buildNodeRuntimePrompt({
			plan,
			node: current,
			userInput:
				"approved: Final statement\nchannels: official, euraxess\nconfirmed: true",
			inputFields: {
				approved: "Final statement",
				channels: ["official", "euraxess"],
				confirmed: true,
			},
		});

		expect(runtime.runtimeInput.context.currentNodeInput).toEqual({
			text: "approved: Final statement\nchannels: official, euraxess\nconfirmed: true",
			fields: {
				approved: "Final statement",
				channels: ["official", "euraxess"],
				confirmed: true,
			},
		});
		expect(runtime.instructions).toContain('"currentNodeInput"');
		expect(runtime.instructions).toContain('"channels": [');
		expect(runtime.instructions).toContain('"confirmed": true');
	});

	it("does not expose checkpoint submit as an AI terminal tool", () => {
		const current = node({
			id: "checkpoint-real-123",
			title: "User approval",
			type: "checkpoint",
		});
		const plan = graph([current]);
		const runtime = buildNodeRuntimePrompt({ plan, node: current });

		expect(runtime.instructions).not.toContain("chrona_checkpoint_submit");
		expect(runtime.instructions).toContain(
			"Checkpoint submission is performed by the user in the frontend",
		);
	});
});
