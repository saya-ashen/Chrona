import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { expect, type APIRequestContext } from "@playwright/test";

type ProviderRun = {
	runId: string;
	sessionId: string;
	status: "running" | "completed";
	terminalOutput: string;
	output?: string;
};

type PlanBlueprint = {
	title: string;
	goal: string;
	assumptions: string[];
	nodes: Array<Record<string, unknown>>;
	edges: Array<Record<string, unknown>>;
};

const EVIDENCE = [
	{ observationId: "task-plan-task" },
	{ observationId: "task-plan-current-head" },
];

const GOLDEN_PATH_BLUEPRINT: PlanBlueprint = {
	title: "E2E durable execution plan",
	goal: "Exercise input, branching, provider execution, approval, and manual completion.",
	assumptions: ["The deterministic debug execution provider is available."],
	nodes: [
		{
			id: "collect_execution_input",
			type: "checkpoint",
			title: "Collect boundary context",
			checkpointType: "input",
			prompt: "Choose the deterministic execution path.",
			required: true,
			inputFields: [
				{
					key: "scenario_label",
					label: "Scenario label",
					inputType: "text",
					required: true,
				},
				{
					key: "include_slow_wait",
					label: "Include slow wait path",
					inputType: "boolean",
					required: true,
				},
				{
					key: "priority",
					label: "Priority",
					inputType: "choice",
					required: true,
					options: ["low", "normal", "urgent"],
				},
			],
		},
		{
			id: "route_execution",
			type: "condition",
			title: "Route execution",
			condition:
				"Does the checkpoint input request the slow external wait path?",
			evaluationBy: "user",
			branches: [
				{ label: "fast path", nextNodeId: "execute_work" },
				{ label: "slow wait", nextNodeId: "wait_for_external_event" },
			],
			defaultNextNodeId: "execute_work",
		},
		{
			id: "execute_work",
			type: "task",
			title: "Execute deterministic work",
			executor: "ai",
			mode: "auto",
			expectedOutput: "A deterministic provider result.",
			completionCriteria: "The provider reports successful work.",
			estimatedMinutes: 5,
		},
		{
			id: "wait_for_external_event",
			type: "wait",
			title: "Wait for external event",
			waitFor: "A deterministic external event used only by the slow branch.",
			estimatedMinutes: 5,
			timeout: { minutes: 10, onTimeout: "pause" },
		},
		{
			id: "approve_execution_result",
			type: "checkpoint",
			title: "Approve execution result",
			checkpointType: "approve",
			prompt: "Approve the deterministic provider result.",
			required: true,
		},
		{
			id: "complete_manual_review",
			type: "task",
			title: "Complete manual review",
			executor: "user",
			mode: "manual",
			expectedOutput: "A reviewed final result.",
			completionCriteria: "The user marks the review complete.",
			estimatedMinutes: 5,
		},
	],
	edges: [
		{ from: "collect_execution_input", to: "route_execution" },
		{ from: "route_execution", to: "execute_work", label: "fast path" },
		{
			from: "route_execution",
			to: "wait_for_external_event",
			label: "slow wait",
		},
		{ from: "execute_work", to: "approve_execution_result" },
		{ from: "wait_for_external_event", to: "approve_execution_result" },
		{ from: "approve_execution_result", to: "complete_manual_review" },
	],
};

function candidateFor(blueprint: PlanBlueprint) {
	return {
		status: "completed",
		output: { blueprint },
		artifacts: [],
		proposedActions: [
			{
				proposalId: "e2e-task-plan-proposal",
				action: { id: "task.plan.blueprint.propose", version: 1 },
				input: { blueprint },
				rationale: "Generate the deterministic E2E task plan.",
				evidence: EVIDENCE,
			},
		],
		evidence: EVIDENCE,
	};
}

const FINALIZED_RESULT_SPEC = {
	parsed: {
		root: "root",
		elements: {
			root: {
				type: "ResultSummary",
				props: {
					title: "Execution complete",
					summary: "The deterministic E2E plan completed successfully.",
				},
			},
		},
	},
};

function readJsonBody(
	request: IncomingMessage,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			try {
				resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
			} catch (error) {
				reject(error);
			}
		});
		request.on("error", reject);
	});
}

function writeJson(
	response: ServerResponse,
	status: number,
	body: unknown,
): void {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

function writeEvent(
	response: ServerResponse,
	event: Record<string, unknown>,
): void {
	response.write(`data: ${JSON.stringify(event)}\n\n`);
}

export type MockTaskPlanProvider = {
	baseUrl: string;
	stop: () => Promise<void>;
};

// eslint-disable-next-line max-lines-per-function -- The protocol mock intentionally dispatches the complete Hermes route surface in one local handler.
export async function startMockTaskPlanProvider(): Promise<MockTaskPlanProvider> {
	const runs = new Map<string, ProviderRun>();
	let nextRunId = 1;

	// eslint-disable-next-line complexity -- The protocol mock intentionally dispatches the complete Hermes route surface in one local handler.
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		try {
			if (
				request.method === "GET" &&
				(url.pathname === "/health" || url.pathname === "/v1/health")
			) {
				writeJson(response, 200, { ok: true, status: "ok" });
				return;
			}
			if (request.method === "GET" && url.pathname === "/v1/capabilities") {
				writeJson(response, 200, {
					features: {
						run_submission: true,
						run_events_sse: true,
						run_status: true,
						run_stop: true,
					},
				});
				return;
			}
			if (request.method === "POST" && url.pathname === "/v1/runs") {
				const body = await readJsonBody(request);
				const runId = `e2e-task-plan-run-${nextRunId++}`;
				const sessionId =
					typeof body.session_id === "string" ? body.session_id : runId;
				const terminalOutput = JSON.stringify(
					sessionId.startsWith("result-finalization:")
						? FINALIZED_RESULT_SPEC
						: candidateFor(GOLDEN_PATH_BLUEPRINT),
				);
				runs.set(runId, {
					runId,
					sessionId,
					status: "running",
					terminalOutput,
				});
				writeJson(response, 200, {
					run_id: runId,
					session_id: sessionId,
					status: "running",
				});
				return;
			}

			const runMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
			if (request.method === "GET" && runMatch) {
				const run = runs.get(decodeURIComponent(runMatch[1] ?? ""));
				if (!run) {
					writeJson(response, 404, { error: "run not found" });
					return;
				}
				writeJson(response, 200, {
					run_id: run.runId,
					session_id: run.sessionId,
					status: run.status,
					...(run.output ? { output: run.output } : {}),
				});
				return;
			}

			const streamMatch = url.pathname.match(/^\/v1\/runs\/([^/]+)\/events$/);
			if (request.method === "GET" && streamMatch) {
				const run = runs.get(decodeURIComponent(streamMatch[1] ?? ""));
				if (!run) {
					writeJson(response, 404, { error: "run not found" });
					return;
				}
				response.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
					connection: "keep-alive",
				});
				run.status = "completed";
				const output = run.terminalOutput;
				run.output = output;
				writeEvent(response, {
					type: "run.completed",
					run_id: run.runId,
					session_id: run.sessionId,
					output,
				});
				response.end();
				return;
			}

			writeJson(response, 404, {
				error: `No mock provider route for ${request.method} ${url.pathname}`,
			});
		} catch {
			writeJson(response, 500, { error: "mock provider request failed" });
		}
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Could not bind mock task-plan provider");

	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		stop: () =>
			new Promise((resolve, reject) => {
				server.close((error) => {
					if (error) reject(error);
					else resolve();
				});
			}),
	};
}

export async function bindTaskPlanProvider(
	request: APIRequestContext,
	taskId: string,
	baseUrl: string,
	features: readonly ("task.plan" | "task.result_finalization")[] = [
		"task.plan",
	],
): Promise<void> {
	const createResponse = await request.post("/api/ai/clients", {
		data: {
			name: `E2E Durable Plan Client ${taskId}`,
			type: "hermes",
			config: { baseUrl, apiKey: "e2e-task-plan-key", timeoutMs: 120_000 },
			isDefault: false,
		},
	});
	if (!createResponse.ok()) {
		throw new Error(
			`Task-plan client creation failed: HTTP ${createResponse.status()} ${await createResponse.text()}`,
		);
	}
	const created = (await createResponse.json()) as { client: { id?: string } };
	expect(created.client.id).toBeTruthy();

	const bindResponse = await request.put(
		`/api/ai/clients/${created.client.id}/bindings`,
		{
			data: { features: [...features] },
		},
	);
	if (!bindResponse.ok()) {
		throw new Error(
			`Task-plan client binding failed: HTTP ${bindResponse.status()} ${await bindResponse.text()}`,
		);
	}
}
