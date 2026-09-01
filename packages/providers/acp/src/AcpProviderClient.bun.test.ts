import { afterEach, describe, expect, it, mock } from "bun:test";
import type {
	ProviderRunEvent,
	StartRunInput,
} from "@chrona/providers-foundation";
import {
	AcpProviderClient,
	type AcpClientHandlers,
	type AcpTransport,
} from "./AcpProviderClient";
import type { AcpProviderConfig } from "./types";

function baseInput(overrides: Partial<StartRunInput> = {}): StartRunInput {
	return {
		sessionId: "acp-session-1",
		instructions: "Finish node.",
		clientOperationId: "acp-base-operation",
		input: "Return success.",
		stream: true,
		...overrides,
	};
}

type RequestRecord = { method: string; params: unknown };

type FakeSession = {
	sessionId: string;
	promptBlocks?: unknown;
	updates: Array<
		| { kind: "session_update"; update: unknown }
		| { kind: "stop"; stopReason: string; response: unknown }
	>;
	prompt(input: unknown): Promise<unknown>;
	nextUpdate(): Promise<FakeSession["updates"][number] | undefined>;
	dispose(): void;
};

class FakeAcpTransport implements AcpTransport {
	readonly requests: RequestRecord[] = [];
	readonly session: FakeSession;
	readonly init: unknown;
	handlers?: AcpClientHandlers;
	readonly stderr: string;

	constructor(
		input: {
			init?: unknown;
			updates?: FakeSession["updates"];
			stderr?: string;
		} = {},
	) {
		this.init = input.init ?? {
			protocolVersion: 1,
			agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } },
		};
		this.stderr = input.stderr ?? "";
		this.session = {
			sessionId: "native-acp-session-1",
			updates: input.updates ?? [],
			async prompt(promptInput) {
				this.promptBlocks = promptInput;
				return { stopReason: "end_turn" };
			},
			async nextUpdate() {
				return this.updates.shift();
			},
			dispose() {},
		};
	}

	async connect<T>(
		_config: AcpProviderConfig,
		handlers: AcpClientHandlers,
		op: (
			connection: Parameters<Parameters<AcpTransport["connect"]>[2]>[0],
		) => Promise<T>,
	): Promise<T> {
		this.handlers = handlers;
		const context = {
			request: async (method: string, params: unknown) => {
				this.requests.push({ method, params });
				if (method === "initialize") return this.init;
				if (method === "authenticate") return {};
				if (method === "session/load") return { modes: null };
				throw new Error(`unexpected request ${method}`);
			},
			buildSession: (params: unknown) => {
				this.requests.push({ method: "session/new", params });
				return {
					start: async () => this.session,
				};
			},
			attachSession: (response: { sessionId: string }) => {
				this.requests.push({ method: "session/attach", params: response });
				return { ...this.session, sessionId: response.sessionId };
			},
			notify: async (method: string, params: unknown) => {
				this.requests.push({ method, params });
			},
		};
		return op({
			context,
			close() {},
			closed: Promise.resolve(),
			diagnostics: { stderr: () => this.stderr },
		} as never);
	}
}

function config(overrides: Partial<AcpProviderConfig> = {}): AcpProviderConfig {
	return {
		provider: "test_acp",
		command: "test-acp",
		...overrides,
	};
}

const ORIGINAL_FETCH = globalThis.fetch;

function stubMcpTools(toolNames: string[]) {
	const calls: Array<{
		url: string;
		init: { headers?: HeadersInit; body?: BodyInit | null };
	}> = [];
	globalThis.fetch = mock(
		async (url: string | URL | Request, init: RequestInit = {}) => {
			calls.push({ url: String(url), init });
			const body =
				typeof init.body === "string"
					? (JSON.parse(init.body) as { method?: string })
					: {};
			if (body.method === "initialize") {
				return new Response("", {
					status: 200,
					headers: { "mcp-session-id": "mcp-session-1" },
				});
			}
			if (body.method === "tools/list") {
				return new Response(
					JSON.stringify({
						jsonrpc: "2.0",
						id: 2,
						result: { tools: toolNames.map((name) => ({ name })) },
					}),
					{ status: 200 },
				);
			}
			return new Response("unexpected MCP method", { status: 400 });
		},
	) as unknown as typeof fetch;
	return calls;
}

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	mock.restore();
});

describe("AcpProviderClient", () => {
	it("exposes generic ACP execution provider capabilities", async () => {
		const transport = new FakeAcpTransport();
		const client = new AcpProviderClient({
			config: config({ displayName: "Test ACP" }),
			transport,
		});

		expect(client.getCapabilities()).toMatchObject({
			supportsSessions: true,
			supportsStreaming: true,
			supportsRunLookup: false,
			supportsCancellation: true,
			supportsToolCalls: true,
			approval: {
				supported: true,
				choices: ["approve_once", "approve_always", "deny"],
				scopes: ["once", "always"],
				resolveAll: false,
			},
			reason: "Test ACP ACP provider",
		});
		await expect(client.checkHealth()).resolves.toMatchObject({
			provider: "test_acp",
			ok: true,
			reason: "Test ACP ACP agent initialized",
		});
		expect(
			transport.requests.some((request) => request.method === "session/new"),
		).toBe(false);
	});

	it("authenticates with advertised agent credentials before opening sessions", async () => {
		stubMcpTools(["terminal_result", "plan_context"]);
		const transport = new FakeAcpTransport({
			init: {
				protocolVersion: 1,
				agentCapabilities: {
					loadSession: true,
					mcpCapabilities: { http: true },
				},
				authMethods: [{ id: "agent", name: "Use existing profile" }],
			},
		});
		const client = new AcpProviderClient({
			config: config({
				healthCheck: "session",
				mcpBaseUrl: "http://chrona.test",
				mcpRunToken: "run-token",
			}),
			transport,
		});

		await expect(client.checkHealth()).resolves.toMatchObject({ ok: true });
		expect(transport.requests.map((request) => request.method)).toEqual([
			"initialize",
			"authenticate",
			"session/new",
		]);
		expect(
			transport.requests.find((request) => request.method === "authenticate")
				?.params,
		).toEqual({ methodId: "agent" });
	});

	it("keeps an existing local agent profile without starting a new login", async () => {
		stubMcpTools(["terminal_result", "plan_context"]);
		const transport = new FakeAcpTransport({
			init: {
				protocolVersion: 1,
				agentCapabilities: {
					loadSession: true,
					mcpCapabilities: { http: true },
				},
				authMethods: [{ id: "api-key" }, { id: "chat-gpt" }],
			},
		});
		const client = new AcpProviderClient({
			config: config({
				auth: { useExisting: true },
				healthCheck: "session",
				mcpBaseUrl: "http://chrona.test",
			}),
			transport,
		});

		await expect(client.checkHealth()).resolves.toMatchObject({ ok: true });
		expect(
			transport.requests.some((request) => request.method === "authenticate"),
		).toBe(false);
		expect(
			transport.requests.some((request) => request.method === "session/new"),
		).toBe(true);
	});

	it("opens a provider session when session health is requested", async () => {
		stubMcpTools(["terminal_result", "plan_context"]);
		const transport = new FakeAcpTransport();
		const client = new AcpProviderClient({
			config: config({
				healthCheck: "session",
				mcpBaseUrl: "http://chrona.test",
				mcpRunToken: "run-token",
			}),
			transport,
		});

		await expect(client.checkHealth()).resolves.toMatchObject({
			provider: "test_acp",
			ok: true,
			reason: "test_acp ACP agent connected",
		});
		expect(
			transport.requests.find((request) => request.method === "session/new")
				?.params,
		).toMatchObject({
			mcpServers: [
				{
					url: "http://chrona.test/api/mcp?session_id=chrona%3Aprovider-health%3Atest_acp",
					headers: [{ name: "Authorization", value: "Bearer run-token" }],
				},
			],
		});
	});

	it("runs a model prompt when prompt health is requested", async () => {
		stubMcpTools(["terminal_result", "plan_context"]);
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "session_update",
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "CHRONA_ACP_HEALTH_OK" },
					},
				},
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({
			config: config({
				healthCheck: "prompt",
				mcpBaseUrl: "http://chrona.test",
			}),
			transport,
		});

		await expect(client.checkHealth()).resolves.toMatchObject({
			ok: true,
			reason: "test_acp model endpoint completed a prompt",
		});
		expect(transport.session.promptBlocks).toEqual([
			{ type: "text", text: "Return only CHRONA_ACP_HEALTH_OK" },
		]);
	});

	it("rejects transport diagnostics returned as prompt health text", async () => {
		stubMcpTools(["terminal_result", "plan_context"]);
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "session_update",
					update: {
						sessionUpdate: "agent_message_chunk",
						content: {
							type: "text",
							text: "unexpected status 401 Unauthorized: invalid API key",
						},
					},
				},
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({
			config: config({
				healthCheck: "prompt",
				mcpBaseUrl: "http://chrona.test",
			}),
			transport,
		});

		await expect(client.checkHealth()).resolves.toMatchObject({
			ok: false,
			reason: "ACP provider transport failed with HTTP 401 Unauthorized",
		});
	});

	it("sends Chrona HTTP MCP server through ACP session setup", async () => {
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({
			config: config({
				mcpBaseUrl: "http://chrona.test",
				mcpRunToken: "run-token",
			}),
			transport,
		});

		const run = await client.startRun(
			baseInput({
				sessionId: "chrona-session",
				sessionKey: "chrona:task:task-1:plan-generation",
				terminalToolName: "terminal_result",
				control: {
					baseUrl: "http://chrona.test/api",
					runToken: "run-token",
				},
			}),
		);
		const streamed = [];
		for await (const event of client.streamRun({ runId: run.runId }))
			streamed.push(event);

		const sessionNew = transport.requests.find(
			(request) => request.method === "session/new",
		);
		expect(sessionNew?.params).toMatchObject({
			cwd: process.cwd(),
			mcpServers: [
				{
					type: "http",
					name: "chrona",
					url: "http://chrona.test/api/mcp?session_id=chrona%3Atask%3Atask-1%3Aplan-generation",
					headers: [{ name: "Authorization", value: "Bearer run-token" }],
				},
			],
		});
		for (const event of streamed) {
			expect(event).toMatchObject({
				provider: "test_acp",
				runId: run.runId,
				sessionId: "chrona-session",
			});
		}
		expect(streamed.at(-1)).toMatchObject({
			type: "run_completed",
			provider: "test_acp",
			nativeSessionId: "native-acp-session-1",
		});
	});

	it("removes Chrona MCP from read-only sessions", async () => {
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({
			config: config({
				mcpBaseUrl: "http://chrona.test",
				mcpRunToken: "run-token",
			}),
			transport,
		});

		const run = await client.startRun(
			baseInput({
				sessionId: "chrona-session-read-only",
				sessionKey: "chrona:goal:review",
				toolPolicy: "read_only",
			}),
		);
		await Array.fromAsync(client.streamRun({ runId: run.runId }));

		expect(
			transport.requests.find((request) => request.method === "session/new")
				?.params,
		).toMatchObject({
			mcpServers: [],
		});
	});
	it("loads the prior ACP session when resumeSessionRef is present", async () => {
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({
			config: config({
				mcpBaseUrl: "http://chrona.test",
				mcpRunToken: "run-token",
			}),
			transport,
		});

		const run = await client.startRun(
			baseInput({
				sessionId: "chrona-session",
				sessionKey: "chrona:task:task-1:execute:plan-1",
				resumeSessionRef: "native-acp-session-prior",
			}),
		);
		const streamed = [];
		for await (const event of client.streamRun({ runId: run.runId }))
			streamed.push(event);

		expect(
			transport.requests.some((request) => request.method === "session/new"),
		).toBe(false);
		expect(
			transport.requests.find((request) => request.method === "session/load")
				?.params,
		).toMatchObject({
			sessionId: "native-acp-session-prior",
			cwd: process.cwd(),
			mcpServers: [
				{
					type: "http",
					name: "chrona",
					url: "http://chrona.test/api/mcp?session_id=chrona%3Atask%3Atask-1%3Aexecute%3Aplan-1",
					headers: [{ name: "Authorization", value: "Bearer run-token" }],
				},
			],
		});
		expect(run).toMatchObject({
			sessionId: "chrona-session",
			nativeSessionId: "native-acp-session-prior",
		});
		expect(streamed.at(-1)).toMatchObject({
			type: "run_completed",
			sessionId: "chrona-session",
			nativeSessionId: "native-acp-session-prior",
		});
	});

	it("treats synthetic Claude Code run ids as ordinary ACP session ids", async () => {
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({
			config: config({
				mcpBaseUrl: "http://chrona.test",
				mcpRunToken: "run-token",
			}),
			transport,
		});
		const syntheticClaudeRef =
			"claude-sdk-3583bad8-4764-417b-9998-973c5b6bde60";

		const run = await client.startRun(
			baseInput({
				sessionId: "chrona-session",
				sessionKey: "chrona:task:task-1:execute:plan-1",
				resumeSessionRef: syntheticClaudeRef,
			}),
		);
		const streamed = [];
		for await (const event of client.streamRun({ runId: run.runId }))
			streamed.push(event);

		expect(
			transport.requests.some((request) => request.method === "session/new"),
		).toBe(false);
		expect(
			transport.requests.find((request) => request.method === "session/load")
				?.params,
		).toMatchObject({
			sessionId: syntheticClaudeRef,
		});
		expect(run).toMatchObject({
			sessionId: "chrona-session",
			nativeSessionId: syntheticClaudeRef,
		});
		expect(streamed.at(-1)).toMatchObject({
			type: "run_completed",
			sessionId: "chrona-session",
			nativeSessionId: syntheticClaudeRef,
		});
	});

	it("rejects resumed runs when the ACP agent cannot load sessions", async () => {
		const transport = new FakeAcpTransport({
			init: {
				protocolVersion: 1,
				agentCapabilities: {
					loadSession: false,
					mcpCapabilities: { http: true },
				},
			},
		});
		const client = new AcpProviderClient({ config: config(), transport });

		await expect(
			client.startRun(
				baseInput({ resumeSessionRef: "native-acp-session-prior" }),
			),
		).rejects.toThrow("agent does not advertise loadSession");
		expect(
			transport.requests.some((request) => request.method === "session/new"),
		).toBe(false);
		expect(
			transport.requests.some((request) => request.method === "session/load"),
		).toBe(false);
	});

	it("ignores blank control base URL and falls back to configured MCP base URL", async () => {
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({
			config: config({
				mcpBaseUrl: "http://chrona.test",
				mcpRunToken: "configured-token",
			}),
			transport,
		});

		const run = await client.startRun({
			...baseInput({ sessionKey: "chrona:session" }),
			control: { baseUrl: " ", runToken: "control-token" },
		} as StartRunInput);
		for await (const _event of client.streamRun({ runId: run.runId })) {
			// drain stream
		}

		const sessionNew = transport.requests.find(
			(request) => request.method === "session/new",
		);
		expect(sessionNew?.params).toMatchObject({
			mcpServers: [
				{
					url: "http://chrona.test/api/mcp?session_id=chrona%3Asession",
					headers: [{ name: "Authorization", value: "Bearer control-token" }],
				},
			],
		});
	});

	it("streams ACP tool completion events", async () => {
		const terminalTool = "terminal_result";
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "session_update",
					update: {
						sessionUpdate: "tool_call_update",
						toolCallId: "call-1",
						title: terminalTool,
						rawInput: { ok: true },
						status: "completed",
					},
				},
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({ config: config(), transport });
		const run = await client.startRun(
			baseInput({ terminalToolName: terminalTool }),
		);
		const streamed: ProviderRunEvent[] = [];

		for await (const event of client.streamRun({ runId: run.runId }))
			streamed.push(event);

		expect(streamed.map((event) => event.type)).toEqual([
			"run_started",
			"tool_call",
			"tool_completed",
			"run_completed",
		]);
		expect(
			streamed.some(
				(event) =>
					event.type === "tool_completed" && event.toolName === terminalTool,
			),
		).toBe(true);
	});

	it("completes when Chrona records the terminal action before aborting ACP", async () => {
		const terminalTool = "chrona_node_complete";
		const controller = new AbortController();
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "session_update",
					update: {
						sessionUpdate: "tool_call_update",
						toolCallId: "call-terminal",
						title: terminalTool,
						rawInput: {
							server: "chrona",
							tool: terminalTool,
							arguments: { summary: "Done" },
						},
						status: "completed",
					},
				},
				{
					kind: "stop",
					stopReason: "cancelled",
					response: { stopReason: "cancelled" },
				},
			],
		});
		const client = new AcpProviderClient({ config: config(), transport });
		const run = await client.startRun(
			baseInput({ terminalToolName: terminalTool, signal: controller.signal }),
		);
		const streamed: ProviderRunEvent[] = [];

		for await (const event of client.streamRun({ runId: run.runId })) {
			streamed.push(event);
			if (event.type === "tool_call" && event.tool === terminalTool) {
				controller.abort("Chrona terminal action recorded");
			}
		}

		expect(streamed.map((event) => event.type)).toEqual([
			"run_started",
			"tool_call",
			"tool_completed",
			"run_completed",
		]);
		expect(streamed.at(-1)).toMatchObject({
			type: "run_completed",
			terminalToolCall: {
				name: terminalTool,
				input: { summary: "Done" },
			},
		});
	});

	it("cancels known runs through ACP session cancel", async () => {
		const transport = new FakeAcpTransport();
		const client = new AcpProviderClient({ config: config(), transport });
		const run = await client.startRun(baseInput());

		await expect(client.cancelRun({ runId: run.runId })).resolves.toMatchObject(
			{
				provider: "test_acp",
				status: "cancelled",
			},
		);
		expect(
			transport.requests.some((request) => request.method === "session/cancel"),
		).toBe(true);
	});

	it("sends runtime prompt text, terminal instruction, and structured schema", async () => {
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({ config: config(), transport });
		const run = await client.startRun(
			baseInput({
				terminalToolName: "terminal_result",
				tools: [{ name: "terminal_result", inputSchema: { type: "object" } }],
				toolPolicy: "terminal_only",
				structuredOutputSchema: {
					name: "result",
					description: "Result payload",
					schema: { type: "object", properties: { ok: { type: "boolean" } } },
				},
			}),
		);

		for await (const _event of client.streamRun({ runId: run.runId })) {
			// drain stream
		}

		expect(transport.session.promptBlocks).toEqual([
			{
				type: "text",
				text: expect.stringContaining(
					"When finished, call the MCP tool `terminal_result`",
				),
			},
		]);
		const promptText =
			(transport.session.promptBlocks as Array<{ text: string }>)[0]?.text ??
			"";
		expect(promptText).toContain("Finish node.");
		expect(promptText).toContain("Return success.");
		expect(promptText).toContain("Structured output schema:");
		expect(promptText).toContain('"ok"');
		expect(promptText).not.toContain("Required Chrona MCP tools for this turn");
		expect(promptText).not.toContain("tool_search");
	});

	it("does not inject Codex-specific MCP discovery instructions into task prompts", async () => {
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({ config: config(), transport });
		const run = await client.startRun(
			baseInput({
				instructions: "You MUST call the custom_terminal tool.",
				input: { type: "text", text: "Complete this task." },
				terminalToolName: "custom_terminal",
				tools: [{ name: "custom_terminal", inputSchema: { type: "object" } }],
				toolPolicy: "terminal_only",
				structuredOutputSchema: {
					name: "custom_terminal",
					description: "Terminal payload",
					schema: {
						type: "object",
						properties: { summary: { type: "string" } },
						required: ["summary"],
					},
				},
			}),
		);

		for await (const _event of client.streamRun({ runId: run.runId })) {
			// drain stream
		}
		const promptText =
			(transport.session.promptBlocks as Array<{ text: string }>)[0]?.text ??
			"";

		expect(promptText).toContain("You MUST call the custom_terminal tool.");
		expect(promptText).toContain("Complete this task.");
		expect(promptText).toContain("Structured output schema:");
		expect(promptText).not.toContain("Required Chrona MCP tools for this turn");
		expect(promptText).not.toContain("mcp__chrona");
		expect(promptText).not.toContain("tool_search");
		expect(promptText).not.toContain("list_mcp_resources");
	});

	it("streams text, reasoning, usage, tool start, and tool failure events", async () => {
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "session_update",
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "hello" },
					},
				},
				{
					kind: "session_update",
					update: {
						sessionUpdate: "agent_thought_chunk",
						content: { type: "text", text: "thinking" },
					},
				},
				{
					kind: "session_update",
					update: { sessionUpdate: "usage_update", used: 7, size: 11 },
				},
				{
					kind: "session_update",
					update: {
						sessionUpdate: "tool_call_update",
						toolCallId: "call-1",
						title: "exec_command",
						rawInput: { cmd: "date" },
						status: "in_progress",
					},
				},
				{
					kind: "session_update",
					update: {
						sessionUpdate: "tool_call_update",
						toolCallId: "call-1",
						title: "exec_command",
						rawInput: { cmd: "date" },
						rawOutput: { stderr: "denied" },
						status: "failed",
					},
				},
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({ config: config(), transport });
		const run = await client.startRun(baseInput());
		const streamed: ProviderRunEvent[] = [];

		for await (const event of client.streamRun({ runId: run.runId }))
			streamed.push(event);

		expect(streamed.map((event) => event.type)).toEqual([
			"run_started",
			"text_delta",
			"reasoning_delta",
			"raw_event",
			"tool_call",
			"tool_started",
			"tool_call",
			"tool_completed",
			"run_completed",
		]);
		expect(streamed.find((event) => event.type === "text_delta")).toMatchObject(
			{ text: "hello" },
		);
		expect(
			streamed.find((event) => event.type === "reasoning_delta"),
		).toMatchObject({ text: "thinking" });
		expect(
			streamed.find((event) => event.type === "tool_started"),
		).toMatchObject({ toolName: "exec_command", input: { cmd: "date" } });
		expect(
			streamed.find((event) => event.type === "tool_completed"),
		).toMatchObject({
			toolName: "exec_command",
			error: { message: "ACP tool call failed", raw: { stderr: "denied" } },
		});
		expect(streamed.at(-1)).toMatchObject({
			type: "run_completed",
			outputText: "hello",
			usage: { inputTokens: 7, outputTokens: 0, totalTokens: 7 },
		});
	});

	it("fails closed when Codex reports a disconnected provider stream as assistant text", async () => {
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "session_update",
					update: {
						sessionUpdate: "agent_message_chunk",
						content: {
							type: "text",
							text: "stream disconnected before completion: upstream request rejected",
						},
					},
				},
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({ config: config(), transport });
		const run = await client.startRun(baseInput());
		const streamed: ProviderRunEvent[] = [];

		for await (const event of client.streamRun({ runId: run.runId }))
			streamed.push(event);

		expect(streamed.map((event) => event.type)).toEqual([
			"run_started",
			"text_delta",
			"run_failed",
		]);
		expect(streamed.at(-1)).toMatchObject({
			type: "run_failed",
			error: expect.stringContaining("stream disconnected before completion"),
		});
		await expect(client.getRun({ runId: run.runId })).resolves.toMatchObject({
			status: "failed",
			error: expect.stringContaining("stream disconnected before completion"),
		});
	});

	it("fails closed when Codex returns transport authentication diagnostics as assistant text", async () => {
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "session_update",
					update: {
						sessionUpdate: "agent_message_chunk",
						content: {
							type: "text",
							text: "Warning: Falling back from WebSockets to HTTPS transport. unexpected status 401 Unauthorized: invalid API key sk-sensitive-value",
						},
					},
				},
				{
					kind: "stop",
					stopReason: "end_turn",
					response: { stopReason: "end_turn" },
				},
			],
		});
		const client = new AcpProviderClient({ config: config(), transport });
		const run = await client.startRun(baseInput());
		const streamed: ProviderRunEvent[] = [];

		for await (const event of client.streamRun({ runId: run.runId }))
			streamed.push(event);

		const terminal = streamed.at(-1);
		expect(terminal).toMatchObject({
			type: "run_failed",
			error: expect.stringContaining("401 Unauthorized"),
		});
		if (terminal?.type !== "run_failed")
			throw new Error("Expected run_failed terminal event");
		expect(String(terminal.error)).not.toContain("sk-sensitive-value");
	});

	it("surfaces upstream auth status from ACP process diagnostics", async () => {
		const transport = new FakeAcpTransport({
			stderr:
				"Request completed method=POST url=https://api.krill-ai.com/codex/v1/responses status=401 Unauthorized",
		});
		transport.session.prompt = async () => {
			throw new Error("Internal error");
		};
		const client = new AcpProviderClient({ config: config(), transport });
		const run = await client.startRun(baseInput());
		const streamed: ProviderRunEvent[] = [];

		for await (const event of client.streamRun({ runId: run.runId }))
			streamed.push(event);

		expect(streamed.at(-1)).toMatchObject({
			type: "run_failed",
			error:
				"Internal error: upstream provider authentication failed (401 Unauthorized). Check provider API key and base URL.",
		});
	});

	it("bridges ACP permission requests into approval events", async () => {
		const transport = new FakeAcpTransport();
		const client = new AcpProviderClient({ config: config(), transport });
		const run = await client.startRun(baseInput());
		const iterator = (
			client.streamRun({ runId: run.runId })
		)[Symbol.asyncIterator]();

		await expect(iterator.next()).resolves.toMatchObject({
			value: { type: "run_started" },
		});
		const permission = transport.handlers?.requestPermission({
			sessionId: "native-acp-session-1",
			toolCall: {
				toolCallId: "call-approval",
				title: "exec_command",
				rawInput: { cmd: "date" },
			},
			options: [
				{ optionId: "allow-once", name: "Allow once", kind: "allow_once" },
				{ optionId: "deny-once", name: "Deny", kind: "reject_once" },
			],
		});

		await expect(iterator.next()).resolves.toMatchObject({
			value: {
				type: "approval_required",
				approval: {
					id: "native-acp-session-1:call-approval",
					provider: "test_acp",
					runId: run.runId,
					choices: ["approve_once", "deny"],
					subject: { type: "tool", label: "exec_command" },
					title: "Approve exec_command",
					summary: "ACP provider requests permission for exec_command.",
				},
			},
		});
		await expect(
			client.resolveApproval({
				runId: run.runId,
				approvalId: "native-acp-session-1:call-approval",
				choice: "approve_once",
			}),
		).resolves.toMatchObject({ status: "resolved", resolved: 1 });
		await expect(permission).resolves.toEqual({
			outcome: { outcome: "selected", optionId: "allow-once" },
		});
		await iterator.return?.();
	});

	it("reports failed health when ACP agent lacks HTTP MCP capability", async () => {
		const client = new AcpProviderClient({
			config: config(),
			transport: new FakeAcpTransport({
				init: {
					protocolVersion: 1,
					agentCapabilities: { mcpCapabilities: { http: false } },
				},
			}),
		});

		await expect(client.checkHealth()).resolves.toMatchObject({
			provider: "test_acp",
			ok: false,
			status: "error",
			reason: expect.stringContaining("HTTP MCP"),
		});
	});

	it("maps ACP cancelled stop to run_cancelled", async () => {
		const transport = new FakeAcpTransport({
			updates: [
				{
					kind: "stop",
					stopReason: "cancelled",
					response: { stopReason: "cancelled" },
				},
			],
		});
		const client = new AcpProviderClient({ config: config(), transport });
		const run = await client.startRun(baseInput());
		const streamed: ProviderRunEvent[] = [];

		for await (const event of client.streamRun({ runId: run.runId }))
			streamed.push(event);

		expect(streamed.map((event) => event.type)).toEqual([
			"run_started",
			"run_cancelled",
		]);
		expect(streamed.at(-1)).toMatchObject({
			type: "run_cancelled",
			provider: "test_acp",
		});
	});
});
