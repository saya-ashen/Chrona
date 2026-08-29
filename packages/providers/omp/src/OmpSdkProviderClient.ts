/* eslint-disable complexity, max-lines, max-lines-per-function -- OMP protocol adaptation explicitly handles every SDK event and recovery variant. */
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
	createAgentSession,
	discoverAuthStorage,
	ModelRegistry,
	SessionManager,
	Settings,
	z,
	type AuthStorage,
	type AgentSession,
	type AgentSessionEvent,
	type CustomTool,
	type ProviderConfigInput,
} from "@oh-my-pi/pi-coding-agent";
import { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp";
import { createLogger, serializeSafeError } from "@chrona/logging";
import {
	BoundedTerminalRunSnapshots,
	assertProviderStartSupported,
	type AgentProviderClient,
	ProviderOperationError,
	type CancelRunInput,
	type CreateSessionInput,
	type GetRunInput,
	type HealthCheckInput,
	type ProviderCapabilities,
	type ProviderConfigurationCapabilities,
	type ProviderRuntimeDiagnostics,
	type ProviderConversationCapabilities,
	type ProviderConversationState,
	type ProviderConversationHandoffInput,
	type ProviderConversationHandoffResult,
	type ProviderConversationTurnInput,
	type ProviderConversationTurnResult,
	type ProviderRunEvent,
	type ProviderRunInput,
	type ProviderRunRef,
	type ProviderRunSnapshot,
	type ProviderRunStatus,
	type ProviderSessionRef,
	type StartRunInput,
	type StreamRunInput,
} from "@chrona/providers-foundation";
import type { OmpProviderConfig } from "./types";

const PROVIDER = "omp";
const SDK_RUN_PREFIX = "omp-sdk";
const log = createLogger("providers.omp");

type Timer = Parameters<typeof clearTimeout>[0];
type QueueItem = ProviderRunEvent | { type: "end" };

type SdkRunHandle = {
	ref: ProviderRunRef;
	input: StartRunInput;
	abort: AbortController;
	session?: AgentSession;
	sessionId: string;
	nativeSessionId?: string;
	status: ProviderRunStatus;
	outputText: string;
	error?: string;
	sequence: number;
	queue: QueueItem[];
	waiters: Array<() => void>;
	done: boolean;
	timer?: Timer;
	startedAt: string;
	unsubscribe?: () => void;
	inputAbortListener?: () => void;
	terminalActionAccepted?: boolean;
	terminalAction?: {
		name: string;
		callId: string;
		input: Record<string, unknown>;
	};
	mcpManager?: MCPManager;
};

function sdkRunStopped(handle: Pick<SdkRunHandle, "done" | "status">): boolean {
	return handle.done || handle.status !== "running";
}

function acceptTerminalAction(
	handle: Pick<SdkRunHandle, "session" | "terminalActionAccepted">,
) {
	handle.terminalActionAccepted = true;
	queueMicrotask(() => {
		void handle.session?.abort({ reason: "Chrona terminal action recorded" });
	});
}

export type OmpSdkProviderOptions = {
	config?: OmpProviderConfig;
};

class AsyncEventQueue {
	constructor(private readonly handle: SdkRunHandle) {}

	push(event: QueueItem) {
		if (this.handle.done && event.type !== "end") return;
		this.handle.queue.push(event);
		const waiters = this.handle.waiters.splice(0);
		for (const wake of waiters) wake();
	}

	async next(signal?: AbortSignal): Promise<QueueItem> {
		for (;;) {
			const item = this.handle.queue.shift();
			if (item) return item;
			if (this.handle.done) return { type: "end" };
			await new Promise<void>((resolve) => {
				let settled = false;
				const wake = () => {
					if (settled) return;
					settled = true;
					const index = this.handle.waiters.indexOf(wake);
					if (index >= 0) this.handle.waiters.splice(index, 1);
					signal?.removeEventListener("abort", wake);
					resolve();
				};
				this.handle.waiters.push(wake);
				signal?.addEventListener("abort", wake, { once: true });
			});
			if (signal?.aborted && this.handle.queue.length === 0)
				return { type: "end" };
		}
	}
}

function now() {
	return new Date().toISOString();
}

function nonEmpty(value?: string | null): string | undefined {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

interface SdkEnvironment {
	agentDir?: string;
	apiKeyEnvName?: string;
	baseUrlEnvName?: string;
}

interface SdkModelSetup {
	authStorage?: AuthStorage;
	modelRegistry?: ModelRegistry;
	modelPattern?: string;
}

interface ModelSelectorParts {
	provider?: string;
	modelId?: string;
}

const DIRECT_CONFIG_PROVIDER = "chrona";

function sdkEnvName(name: string, runId: string) {
	const suffix = runId.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
	return `${name}_${suffix}`;
}

function splitModelSelector(model?: string): ModelSelectorParts {
	const value = nonEmpty(model);
	if (!value) return {};
	const separator = value.indexOf("/");
	if (separator <= 0) return { modelId: value };
	return {
		provider: value.slice(0, separator),
		modelId: value.slice(separator + 1),
	};
}

function resolveSdkModelSelection(config: OmpProviderConfig) {
	const model = nonEmpty(config.model);
	const configuredProvider = nonEmpty(config.provider);
	if (configuredProvider) {
		return {
			provider: configuredProvider,
			modelId: model,
			modelPattern: model ? `${configuredProvider}/${model}` : undefined,
		};
	}
	const selector = splitModelSelector(model);
	return {
		provider: selector.provider ?? DIRECT_CONFIG_PROVIDER,
		modelId: selector.modelId,
		modelPattern: model,
	};
}

function withSdkRuntimeModel(
	config: OmpProviderConfig,
	runtimeModel: string | undefined,
): OmpProviderConfig {
	const model = nonEmpty(runtimeModel);
	if (!model) return config;
	const selector = splitModelSelector(model);
	return {
		...config,
		...(selector.provider ? { provider: selector.provider } : {}),
		model: selector.modelId,
	};
}

function directConfigApi(
	config: OmpProviderConfig,
): NonNullable<ProviderConfigInput["api"]> {
	return (nonEmpty(config.api) ?? "openai-responses") as NonNullable<
		ProviderConfigInput["api"]
	>;
}

function hasDirectProviderConfig(config: OmpProviderConfig): boolean {
	return Boolean(nonEmpty(config.apiKey) || nonEmpty(config.baseUrl));
}

async function loadSdkSettings(environment: SdkEnvironment, cwd: string) {
	return Settings.loadIsolated({ cwd, agentDir: environment.agentDir });
}

async function createSdkModelSetup(
	config: OmpProviderConfig,
	environment: SdkEnvironment,
): Promise<SdkModelSetup> {
	const selection = resolveSdkModelSelection(config);
	if (!hasDirectProviderConfig(config))
		return { modelPattern: selection.modelPattern };

	const authStorage = await discoverAuthStorage(environment.agentDir);
	const modelRegistry = new ModelRegistry(authStorage);
	const api = directConfigApi(config);
	const baseUrl = environment.baseUrlEnvName
		? nonEmpty(process.env[environment.baseUrlEnvName])
		: undefined;
	const apiKey = environment.apiKeyEnvName;
	const apiOverride = nonEmpty(config.api) ? { api } : {};
	const existingModel = selection.modelId
		? modelRegistry.find(selection.provider, selection.modelId)
		: undefined;

	modelRegistry.registerProvider(
		selection.provider,
		selection.modelId && !existingModel
			? {
					baseUrl,
					apiKey,
					api,
					models: [
						{
							id: selection.modelId,
							name: selection.modelId,
							api,
							baseUrl,
							reasoning: true,
							input: ["text"],
							supportsTools: true,
							contextWindow: 200_000,
							maxTokens: 64_000,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						},
					],
				}
			: { baseUrl, apiKey, ...apiOverride },
	);
	return {
		authStorage,
		modelRegistry,
		modelPattern: selection.modelId
			? `${selection.provider}/${selection.modelId}`
			: selection.modelPattern,
	};
}

function renderProviderInput(input: ProviderRunInput): string {
	if (typeof input === "string") return input;
	if (Array.isArray(input)) {
		for (const item of input) {
			if (
				item &&
				typeof item === "object" &&
				"type" in item &&
				item.type === "text" &&
				typeof item.text === "string"
			) {
				return item.text;
			}
		}
	}
	if (
		typeof input === "object" &&
		"type" in input &&
		input.type === "text" &&
		typeof input.text === "string"
	) {
		return input.text;
	}
	return JSON.stringify(input, null, 2);
}

function terminalToolInstruction(input: StartRunInput): string | undefined {
	const terminalToolName = input.terminalToolName;
	if (
		!terminalToolName ||
		!input.tools?.some((tool) => tool.name === terminalToolName)
	)
		return undefined;
	return [
		`When finished, call the declared custom tool \`${terminalToolName}\` with its required final payload.`,
		"Do not treat this instruction itself as evidence that the tool has run.",
	].join("\n");
}

function inputToPrompt(input: StartRunInput): string {
	return [
		input.instructions,
		terminalToolInstruction(input),
		renderProviderInput(input.input),
		input.structuredOutputSchema
			? `Structured output schema:\n${JSON.stringify(input.structuredOutputSchema.schema, null, 2)}`
			: undefined,
	]
		.filter(
			(part): part is string => typeof part === "string" && part.length > 0,
		)
		.join("\n\n");
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function parseStructuredPayload(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function runRef(handle: SdkRunHandle, status = handle.status): ProviderRunRef {
	return {
		...handle.ref,
		sessionId: handle.sessionId,
		nativeSessionId: handle.nativeSessionId,
		status,
	};
}

function eventBase(handle: SdkRunHandle, rawEventType?: string) {
	return {
		provider: PROVIDER,
		runId: handle.ref.runId,
		nativeRunId: handle.ref.nativeRunId,
		sessionId: handle.sessionId,
		nativeSessionId: handle.nativeSessionId,
		sequence: handle.sequence++,
		timestamp: now(),
		rawEventType,
	};
}

type JsonSchema = Record<string, unknown>;

function jsonSchemaToZod(schema: unknown): z.ZodType {
	const definition = asRecord(schema) as JsonSchema;
	const type =
		typeof definition.type === "string"
			? definition.type
			: "properties" in definition
				? "object"
				: "items" in definition
					? "array"
					: undefined;
	const enumValues = Array.isArray(definition.enum)
		? definition.enum
		: undefined;
	let result: z.ZodType;

	switch (type) {
		case "object": {
			const properties = Object.fromEntries(
				Object.entries(asRecord(definition.properties)).map(([name, value]) => [
					name,
					jsonSchemaToZod(value),
				]),
			) as Record<string, z.ZodType>;
			const required = new Set(
				Array.isArray(definition.required)
					? definition.required.filter(
							(name): name is string => typeof name === "string",
						)
					: [],
			);
			const shape = Object.fromEntries(
				Object.entries(properties).map(([name, value]) => [
					name,
					required.has(name) ? value : value.optional(),
				]),
			);
			result =
				definition.additionalProperties === false
					? z.object(shape).strict()
					: z.object(shape).catchall(z.unknown());
			break;
		}
		case "array":
			result = z.array(jsonSchemaToZod(definition.items));
			break;
		case "string":
			result = z.string();
			break;
		case "number":
			result = z.number();
			break;
		case "integer":
			result = z.number().int();
			break;
		case "boolean":
			result = z.boolean();
			break;
		case "null":
			result = z.null();
			break;
		default:
			result = z.unknown();
			break;
	}

	return enumValues
		? result.refine((value) =>
				enumValues.some((candidate) => Object.is(candidate, value)),
			)
		: result;
}

function isDeclaredTerminalTool(
	terminalToolName: string | undefined,
	tools: StartRunInput["tools"],
	toolName: string,
): boolean {
	return (
		terminalToolName === toolName &&
		tools?.some((tool) => tool.name === toolName) === true
	);
}

function acceptedToolResult() {
	return {
		content: [{ type: "text" as const, text: "accepted" }],
		details: { accepted: true },
	};
}

function createDeclaredTool(
	definition: NonNullable<StartRunInput["tools"]>[number],
	terminalToolName: string | undefined,
	onTerminalAccepted?: () => void,
): CustomTool {
	return {
		name: definition.name,
		label: definition.name,
		strict: true,
		description: definition.description ?? `Execute ${definition.name}.`,
		parameters: jsonSchemaToZod(definition.inputSchema),
		async execute(_toolCallId, _params, _onUpdate, ctx) {
			if (definition.name === terminalToolName) {
				onTerminalAccepted?.();
				queueMicrotask(() => ctx.abort());
			}
			return acceptedToolResult();
		},
	};
}

function sdkToolOptions(
	tools: StartRunInput["tools"],
	terminalToolName: string | undefined,
	onTerminalAccepted?: () => void,
): { customTools: CustomTool[] } {
	return {
		customTools: (tools ?? []).map((tool) =>
			createDeclaredTool(tool, terminalToolName, onTerminalAccepted),
		),
	};
}

const CHRONA_MCP_SERVER_NAME = "chrona";

type ChronaControlConnection = NonNullable<StartRunInput["control"]>;

type ConnectedChronaMcpControl = {
	manager: MCPManager;
	tools: CustomTool[];
	connection: ChronaControlConnection;
};

function trimTrailingSlashes(value: string): string {
	let end = value.length;
	while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
	return value.slice(0, end);
}

function chronaMcpUrl(baseUrl: string, sessionId: string): string {
	const trimmedBaseUrl = trimTrailingSlashes(baseUrl.trim());
	const apiBaseUrl = trimmedBaseUrl.endsWith("/api")
		? trimmedBaseUrl
		: `${trimmedBaseUrl}/api`;
	try {
		const url = new URL(`${apiBaseUrl}/mcp`);
		if (sessionId.trim()) url.searchParams.set("session_id", sessionId.trim());
		return url.toString();
	} catch (cause) {
		throw new Error(`Invalid Chrona MCP base URL: ${baseUrl}`, { cause });
	}
}

function chronaAgentControlUrl(baseUrl: string): string {
	const trimmedBaseUrl = trimTrailingSlashes(baseUrl.trim());
	const apiBaseUrl = trimmedBaseUrl.endsWith("/api")
		? trimmedBaseUrl
		: `${trimmedBaseUrl}/api`;
	return `${apiBaseUrl}/agent/control`;
}

const CHRONA_TERMINAL_CONTROL_KINDS = {
	chrona_node_complete: "complete",
	chrona_condition_select: "condition_select",
	chrona_wait_complete: "wait_complete",
	chrona_node_block: "block",
	chrona_node_fail: "fail",
	chrona_node_request_input: "request_input",
} as const;

type ChronaTerminalControlKind =
	(typeof CHRONA_TERMINAL_CONTROL_KINDS)[keyof typeof CHRONA_TERMINAL_CONTROL_KINDS];

function isRunTerminalTool(input: StartRunInput, toolName: string) {
	return (
		isDeclaredTerminalTool(input.terminalToolName, input.tools, toolName) ||
		(Boolean(input.control) &&
			Object.hasOwn(CHRONA_TERMINAL_CONTROL_KINDS, toolName))
	);
}

async function invokeChronaTerminalControl(
	input: {
		connection: ChronaControlConnection;
		kind: ChronaTerminalControlKind;
		payload: unknown;
	},
	fetcher: typeof fetch = fetch,
) {
	const response = await fetcher(
		chronaAgentControlUrl(input.connection.baseUrl),
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${input.connection.runToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				body: { kind: input.kind, payload: input.payload },
			}),
		},
	);
	const responseText = await response.text();
	if (!response.ok) {
		throw new Error(
			`Chrona rejected terminal action '${input.kind}' (HTTP ${response.status}): ${responseText.slice(0, 300)}`,
		);
	}
	let details: unknown;
	try {
		details = JSON.parse(responseText);
	} catch {
		throw new Error(
			`Chrona returned an invalid terminal acknowledgement for '${input.kind}'`,
		);
	}
	const acknowledgement =
		details && typeof details === "object"
			? (details as Record<string, unknown>)
			: null;
	if (
		acknowledgement?.ok !== true ||
		acknowledgement.kind !== input.kind ||
		(acknowledgement.recorded !== true &&
			acknowledgement.alreadyAccepted !== true)
	) {
		throw new Error(
			`Chrona did not durably acknowledge terminal action '${input.kind}'`,
		);
	}
	return {
		content: [{ type: "text" as const, text: responseText }],
		details,
	};
}

function useChronaTerminalControl(
	tool: CustomTool,
	connection: ChronaControlConnection,
	onTerminalAccepted?: () => void,
): CustomTool {
	const kind = (
		CHRONA_TERMINAL_CONTROL_KINDS as Partial<
			Record<string, ChronaTerminalControlKind>
		>
	)[tool.name];
	if (!kind) return tool;
	return {
		...tool,
		async execute(_toolCallId, params, _onUpdate, ctx) {
			const result = await invokeChronaTerminalControl({
				connection,
				kind,
				payload: params,
			});
			onTerminalAccepted?.();
			queueMicrotask(() => ctx.abort());
			return result;
		},
	};
}

function exposeChronaMcpTool(tool: CustomTool): CustomTool {
	const name = tool.name.startsWith("mcp__")
		? tool.name.slice("mcp__".length)
		: tool.name;
	return {
		...tool,
		name,
		label: name,
		execute: tool.execute.bind(tool),
	};
}

async function connectChronaMcpControl(
	input: { control: StartRunInput["control"]; sessionId: string; cwd: string },
	managerFactory: (cwd: string) => MCPManager = (cwd) => new MCPManager(cwd),
): Promise<ConnectedChronaMcpControl | undefined> {
	if (!input.control) return undefined;
	const manager = managerFactory(input.cwd);
	const result = await manager.connectServers(
		{
			[CHRONA_MCP_SERVER_NAME]: {
				type: "http",
				url: chronaMcpUrl(input.control.baseUrl, input.sessionId),
				headers: { Authorization: `Bearer ${input.control.runToken}` },
			},
		},
		{
			[CHRONA_MCP_SERVER_NAME]: {
				provider: "chrona-control-plane",
				providerName: "Chrona control plane",
				path: resolve(input.cwd, ".chrona-runtime-control"),
				level: "native",
			},
		},
	);
	const immediateError =
		result.errors.get(CHRONA_MCP_SERVER_NAME) ?? [...result.errors.values()][0];
	if (immediateError) {
		await manager.disconnectAll().catch(() => undefined);
		throw new Error(
			`Oh My Pi could not connect to the Chrona control plane: ${immediateError}`,
		);
	}
	try {
		await manager.waitForConnection(CHRONA_MCP_SERVER_NAME);
		await manager.refreshServerTools(CHRONA_MCP_SERVER_NAME);
	} catch (cause) {
		await manager.disconnectAll().catch(() => undefined);
		const detail =
			cause instanceof Error ? cause.message.trim() : String(cause).trim();
		throw new Error(
			`Oh My Pi could not connect to the Chrona control plane${detail ? `: ${detail}` : "."}`,
			{ cause },
		);
	}
	const tools = (manager.getTools() as CustomTool[]).map(exposeChronaMcpTool);
	if (
		!manager.getConnectedServers().includes(CHRONA_MCP_SERVER_NAME) ||
		tools.length === 0
	) {
		await manager.disconnectAll().catch(() => undefined);
		throw new Error(
			"Oh My Pi connected to the Chrona control plane without receiving its tools.",
		);
	}
	return { manager, tools, connection: input.control };
}

function sdkRunToolOptions(
	tools: StartRunInput["tools"],
	terminalToolName: string | undefined,
	onTerminalAccepted: (() => void) | undefined,
	control: ConnectedChronaMcpControl | undefined,
) {
	const declared = sdkToolOptions(tools, terminalToolName, onTerminalAccepted);
	if (!control) {
		const ungovernedTerminalTool = declared.customTools.find((tool) =>
			Object.hasOwn(CHRONA_TERMINAL_CONTROL_KINDS, tool.name),
		);
		if (ungovernedTerminalTool) {
			throw new Error(
				`Chrona terminal tool '${ungovernedTerminalTool.name}' requires run-scoped control authorization.`,
			);
		}
		return declared;
	}
	const controlledDeclaredTools = declared.customTools.map((tool) =>
		useChronaTerminalControl(tool, control.connection, onTerminalAccepted),
	);
	const controlledMcpTools = control.tools.map((tool) =>
		useChronaTerminalControl(tool, control.connection, onTerminalAccepted),
	);
	const mcpToolNames = new Set(controlledMcpTools.map((tool) => tool.name));
	return {
		customTools: [
			...controlledDeclaredTools.filter((tool) => !mcpToolNames.has(tool.name)),
			...controlledMcpTools,
		],
	};
}

function toolCallPreview(
	event: Extract<AgentSessionEvent, { type: "tool_execution_start" }>,
): string | undefined {
	return event.intent?.trim() || undefined;
}

function textContentPreview(value: unknown): string | undefined {
	if (
		!value ||
		typeof value !== "object" ||
		!("content" in value) ||
		!Array.isArray(value.content)
	) {
		return undefined;
	}
	const text = value.content
		.flatMap((item) =>
			item &&
			typeof item === "object" &&
			"text" in item &&
			typeof item.text === "string"
				? [item.text]
				: [],
		)
		.join("\n")
		.trim();
	if (!text) return undefined;
	return text.length > 2_000 ? `${text.slice(0, 1_997)}...` : text;
}

function sdkLifecycleSummary(event: AgentSessionEvent): string | undefined {
	switch (event.type) {
		case "turn_start":
			return "Agent turn started.";
		case "turn_end":
			return "Agent turn completed.";
		case "auto_compaction_start":
			return `Context compaction started (${event.action}).`;
		case "auto_compaction_end":
			return event.aborted
				? "Context compaction was aborted."
				: `Context compaction completed (${event.action}).`;
		case "auto_retry_start":
			return `Retry ${event.attempt}/${event.maxAttempts} scheduled after provider error.`;
		case "auto_retry_end":
			return event.success
				? `Retry ${event.attempt} succeeded.`
				: `Retry ${event.attempt} failed.`;
		case "retry_fallback_applied":
			return `Model fallback applied: ${event.from} → ${event.to}.`;
		case "retry_fallback_succeeded":
			return `Model fallback succeeded with ${event.model}.`;
		case "notice":
			return event.message;
		case "todo_reminder":
			return `Agent todo reminder (${event.todos.length} open items).`;
		case "todo_auto_clear":
			return "Agent todo list completed.";
		case "thinking_level_changed":
			return `Thinking level changed to ${event.resolved ?? event.thinkingLevel ?? "default"}.`;
		default:
			return undefined;
	}
}

function agentEndFailure(
	event: Extract<AgentSessionEvent, { type: "agent_end" }>,
): string | null {
	const message = event.messages.findLast(
		(entry) => entry.role === "assistant",
	);
	if (!message) return "Oh My Pi SDK ended without an assistant result";
	if (message.stopReason !== "error" && message.stopReason !== "aborted")
		return null;
	return (
		message.errorMessage?.trim() ||
		(message.stopReason === "aborted"
			? "Oh My Pi SDK run was aborted"
			: "Oh My Pi SDK run failed")
	);
}

function agentEndOutcome(
	event: Extract<AgentSessionEvent, { type: "agent_end" }>,
	terminalActionAccepted: boolean,
): { status: "completed" } | { status: "failed"; error: string } {
	if (terminalActionAccepted) return { status: "completed" };
	const error = agentEndFailure(event);
	return error ? { status: "failed", error } : { status: "completed" };
}
function terminalToolFromSnapshot(input: {
	raw?: unknown;
	terminalToolName?: string;
	tools?: StartRunInput["tools"];
}) {
	const terminal = asRecord(asRecord(input.raw).terminalTool);
	const name = terminal.name;
	if (
		typeof name !== "string" ||
		!isDeclaredTerminalTool(input.terminalToolName, input.tools, name)
	)
		return null;
	return {
		name,
		input: asRecord(terminal.input),
	};
}

function sdkModelPatternForSession(
	modelPattern: string | undefined,
	resumeSessionRef: string | undefined,
) {
	// A resumed OMP session already persists its concrete model selection. Let
	// the SDK restore that model from session history, then verify it against
	// the requested model. Passing it again turns restoration into a fresh
	// deferred lookup and can resolve to no model when the provider is supplied
	// by the resumed session's extension/config context.
	return resumeSessionRef ? undefined : modelPattern;
}

function assertExpectedModel(
	expectedModel: string | undefined,
	actualModel: string | null,
) {
	if (!expectedModel || actualModel === expectedModel) return;
	throw new Error(
		`OMP model routing conflict: expected '${expectedModel}', resolved '${actualModel ?? "none"}'`,
	);
}

function sdkReadOnlyToolOptions(toolPolicy: StartRunInput["toolPolicy"]) {
	return toolPolicy === "read_only" || toolPolicy === "terminal_only"
		? { toolNames: [] as string[], enableMCP: false, enableLsp: false }
		: {};
}

type SdkHealthSession = Pick<AgentSession, "abort" | "prompt" | "subscribe">;
type SdkHealthProbeResult =
	| { ok: true }
	| { ok: false; reason: string };

async function probeSdkSessionHealth(
	session: SdkHealthSession,
	input: HealthCheckInput | undefined,
): Promise<SdkHealthProbeResult> {
	if (input?.signal?.aborted) {
		return { ok: false, reason: "Oh My Pi health check was aborted" };
	}
	const timeoutMs = input?.timeoutMs ?? 60_000;
	const { promise, resolve } = Promise.withResolvers<SdkHealthProbeResult>();
	let settled = false;
	const settle = (result: SdkHealthProbeResult) => {
		if (settled) return;
		settled = true;
		resolve(result);
	};
	const unsubscribe = session.subscribe((event) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "error"
		) {
			settle({ ok: false, reason: event.assistantMessageEvent.reason });
			return;
		}
		if (event.type !== "agent_end") return;
		const outcome = agentEndOutcome(event, false);
		settle(
			outcome.status === "completed"
				? { ok: true }
				: { ok: false, reason: outcome.error },
		);
	});
	const abort = () => {
		settle({ ok: false, reason: "Oh My Pi health check was aborted" });
		void session.abort();
	};
	input?.signal?.addEventListener("abort", abort, { once: true });
	const timer = setTimeout(() => {
		settle({
			ok: false,
			reason: `Oh My Pi health check timed out after ${timeoutMs}ms`,
		});
		void session.abort();
	}, timeoutMs);
	const prompt = session
		.prompt("Connectivity check. Reply with the single word pong.", {
			expandPromptTemplates: false,
		})
		.then((ran) => {
			if (!ran) {
				settle({ ok: false, reason: "Oh My Pi health probe did not run" });
			}
		})
		.catch((error: unknown) => {
			settle({
				ok: false,
				reason: error instanceof Error ? error.message : String(error),
			});
		});
	try {
		return await promise;
	} finally {
		clearTimeout(timer);
		input?.signal?.removeEventListener("abort", abort);
		unsubscribe();
		await prompt;
	}
}

export const __ompSdkProviderTestHooks = {
	AsyncEventQueue,
	jsonSchemaToZod,
	sdkToolOptions,
	chronaMcpUrl,
	connectChronaMcpControl,
	sdkRunToolOptions,
	sdkRunStopped,
	acceptTerminalAction,
	isRunTerminalTool,
	chronaAgentControlUrl,
	invokeChronaTerminalControl,
	sdkReadOnlyToolOptions,
	probeSdkSessionHealth,
	sdkToolErrorMessage,
	isDeclaredTerminalTool,
	agentEndFailure,
	agentEndOutcome,
	toolCallPreview,
	textContentPreview,
	terminalToolFromSnapshot,
	sdkLifecycleSummary,
	assertExpectedModel,
	sdkModelPatternForSession,
	resolveSdkModelSelection,
	withSdkRuntimeModel,
	createSdkModelSetup,
	loadSdkSettings,
};

function applySdkEnvironment(
	config: OmpProviderConfig,
	runId = "health",
): SdkEnvironment {
	const env = { ...(config.env ?? {}) };
	const homeDirectory = nonEmpty(config.homeDirectory);
	const configDirectory = nonEmpty(config.configDirectory);
	const codingAgentDirectory = nonEmpty(config.codingAgentDirectory);
	const apiKey = nonEmpty(config.apiKey);
	const baseUrl = nonEmpty(config.baseUrl);
	const apiKeyEnvName = apiKey
		? sdkEnvName("CHRONA_OMP_API_KEY", runId)
		: undefined;
	const baseUrlEnvName = baseUrl
		? sdkEnvName("CHRONA_OMP_BASE_URL", runId)
		: undefined;
	if (homeDirectory) env.HOME = homeDirectory;
	if (configDirectory) env.PI_CONFIG_DIR = configDirectory;
	if (codingAgentDirectory) env.PI_CODING_AGENT_DIR = codingAgentDirectory;
	if (apiKey && apiKeyEnvName) env[apiKeyEnvName] = apiKey;
	if (baseUrl && baseUrlEnvName) env[baseUrlEnvName] = baseUrl;
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === "string") process.env[key] = value;
	}
	return {
		agentDir: codingAgentDirectory ?? configDirectory,
		apiKeyEnvName,
		baseUrlEnvName,
	};
}

function sdkToolErrorMessage(result: unknown): string {
	if (
		!result ||
		typeof result !== "object" ||
		!("content" in result) ||
		!Array.isArray(result.content)
	) {
		return "Oh My Pi SDK tool call failed";
	}
	const messages = result.content.flatMap((item) => {
		if (
			!item ||
			typeof item !== "object" ||
			!("text" in item) ||
			typeof item.text !== "string"
		)
			return [];
		const text = item.text.replace(/\s+/g, " ").trim();
		return text ? [text] : [];
	});
	return messages.join(" ").slice(0, 500) || "Oh My Pi SDK tool call failed";
}

export class OmpSdkProviderClient implements AgentProviderClient {
	readonly provider = PROVIDER;
	private readonly config: OmpProviderConfig;
	private readonly runs = new Map<string, SdkRunHandle>();
	private readonly terminalSnapshots = new BoundedTerminalRunSnapshots();
	private readonly startedClientOperations = new Set<string>();

	constructor(opts: OmpSdkProviderOptions = {}) {
		this.config = opts.config ?? {};
	}

	getConfigurationCapabilities(): ProviderConfigurationCapabilities {
		return {
			model: { supported: true, taskOverride: true },
			context: {
				supported: true,
				taskOverride: true,
				strategies: [
					"provider_default",
					"auto_compact",
					"bounded_tool_results",
					"artifact_backed",
				],
			},
			tooling: {
				mcp: { supported: true, enabled: true },
				lsp: { supported: true, enabled: true },
				subagents: { supported: true, enabled: true },
				enabledTools: [],
			},
		};
	}

	async getRuntimeDiagnostics(): Promise<ProviderRuntimeDiagnostics> {
		const environment = applySdkEnvironment(this.config, "diagnostics");
		const cwd = nonEmpty(this.config.cwd) ?? process.cwd();
		const configuredAgentDirectory =
			nonEmpty(this.config.codingAgentDirectory) ??
			nonEmpty(this.config.configDirectory);
		const setup = await createSdkModelSetup(this.config, environment);
		const settings = await loadSdkSettings(environment, cwd);
		const { session, mcpManager } = await createAgentSession({
			cwd,
			agentDir: configuredAgentDirectory,
			modelPattern: setup.modelPattern,
			...(setup.authStorage ? { authStorage: setup.authStorage } : {}),
			...(setup.modelRegistry ? { modelRegistry: setup.modelRegistry } : {}),
			settings,
			sessionManager: SessionManager.inMemory(cwd),
			skipPythonPreflight: true,
			hasUI: false,
		});
		try {
			const enabledTools = session.getActiveToolNames().sort();
			const configurationCapabilities: ProviderConfigurationCapabilities = {
				...this.getConfigurationCapabilities(),
				tooling: {
					mcp: { supported: true, enabled: Boolean(mcpManager) },
					lsp: { supported: true, enabled: enabledTools.includes("lsp") },
					subagents: {
						supported: true,
						enabled: enabledTools.includes("task"),
					},
					enabledTools,
				},
			};
			const configuredConfigDirectory = nonEmpty(this.config.configDirectory);
			const effectiveAgentDirectory = session.settings.getAgentDir();
			const effectiveModel = session.model;
			return {
				provider: PROVIDER,
				model: effectiveModel
					? `${effectiveModel.provider}/${effectiveModel.id}`
					: null,
				contextWindow: effectiveModel?.contextWindow ?? null,
				contextStrategy: "auto_compact",
				workingDirectory: session.settings.getCwd(),
				configDirectory: configuredConfigDirectory
					? resolve(configuredConfigDirectory)
					: resolve(effectiveAgentDirectory, ".."),
				agentDirectory: effectiveAgentDirectory,
				configurationCapabilities,
				sources: {
					model: nonEmpty(this.config.model)
						? "provider_override"
						: "provider_default",
					context: "provider_default",
					configDirectory: configuredConfigDirectory
						? "provider_override"
						: "provider_default",
					agentDirectory: configuredAgentDirectory
						? "provider_override"
						: "provider_default",
					tools: "runtime",
				},
			};
		} finally {
			await session.dispose();
		}
	}

	getCapabilities(): ProviderCapabilities {
		return {
			supportsSessions: true,
			supportsStreaming: true,
			supportsRunLookup: true,
			supportsCancellation: true,
			supportsToolCalls: true,
			supportsPreviousResponse: false,
			actionInvocation: "unsupported",
			startIdempotency: "unsupported",
			readOnlySingleAttempt: true,
			lookupByClientOperationId: false,
			recovery: {
				sessionResume: true,
				historyReplay: true,
				activeRunLookup: false,
				streamReconnect: false,
				crossProcessDurable: false,
				mode: "session_history",
				providerResumeRef: true,
				runEventReplay: false,
			},
			reason:
				"Oh My Pi SDK custom tools run in-process from request-declared definitions.",
		};
	}

	async checkHealth(input?: HealthCheckInput) {
		const started = Date.now();
		try {
			// Health must exercise the same SDK model resolution path as a real run.
			// A non-empty selector only proves that configuration was typed; it does
			// not prove that OMP can restore credentials and an executable model.
			const environment = applySdkEnvironment(this.config, "health");
			const setup = await createSdkModelSetup(this.config, environment);
			if (!setup.modelPattern) {
				return {
					provider: PROVIDER,
					ok: false,
					checkedAt: now(),
					latencyMs: Date.now() - started,
					reason: "No OMP model could be resolved from this configuration.",
				};
			}
			const cwd = nonEmpty(this.config.cwd) ?? process.cwd();
			const agentDir =
				nonEmpty(this.config.codingAgentDirectory) ??
				nonEmpty(this.config.configDirectory);
			const settings = await loadSdkSettings(environment, cwd);
			const { session, mcpManager } = await createAgentSession({
				cwd,
				agentDir,
				modelPattern: setup.modelPattern,
				...(setup.authStorage ? { authStorage: setup.authStorage } : {}),
				...(setup.modelRegistry ? { modelRegistry: setup.modelRegistry } : {}),
				settings,
				sessionManager: SessionManager.inMemory(cwd),
				toolNames: [],
				enableMCP: false,
				enableLsp: false,
				skipPythonPreflight: true,
				hasUI: false,
			});
			try {
				const model = session.model;
				if (!model) {
					return {
						provider: PROVIDER,
						ok: false,
						checkedAt: now(),
						latencyMs: Date.now() - started,
						reason:
							"OMP could not resolve an executable model. Check OMP login, model selection, and agent directory.",
					};
				}
				const probe = await probeSdkSessionHealth(session, input);
				if (!probe.ok) {
					return {
						provider: PROVIDER,
						ok: false,
						checkedAt: now(),
						latencyMs: Date.now() - started,
						reason: probe.reason,
					};
				}
				return {
					provider: PROVIDER,
					ok: true,
					checkedAt: now(),
					latencyMs: Date.now() - started,
					message: `Oh My Pi SDK reached model ${model.provider}/${model.id}`,
				};
			} finally {
				await session.dispose();
				await mcpManager?.disconnectAll();
			}
		} catch (error) {
			return {
				provider: PROVIDER,
				ok: false,
				checkedAt: now(),
				latencyMs: Date.now() - started,
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	}

	getConversationCapabilities(): ProviderConversationCapabilities {
		return {
			resume: true,
			fork: true,
			compact: true,
			handoff: "native",
			contextUsage: "detailed",
		};
	}

	async inspectConversation(
		sessionRef: string,
	): Promise<ProviderConversationState> {
		try {
			const manager = await SessionManager.open(
				sessionRef,
				undefined,
				undefined,
				{
					initialCwd: nonEmpty(this.config.cwd) ?? process.cwd(),
					suppressBreadcrumb: true,
				},
			);
			const { session } = await this.createConversationSession(manager);
			const usage = session.getContextUsage();
			await session.dispose();
			return {
				available: true,
				sessionRef,
				compacted: manager
					.getEntries()
					.some((entry) => entry.type === "compaction"),
				contextTokens: usage?.tokens,
				contextWindow: usage?.contextWindow,
			};
		} catch {
			return { available: false, sessionRef, compacted: false };
		}
	}

	async handoffConversation(
		input: ProviderConversationHandoffInput,
	): Promise<ProviderConversationHandoffResult> {
		const cwd = nonEmpty(this.config.cwd) ?? process.cwd();
		const manager = await SessionManager.open(
			input.sessionRef,
			undefined,
			undefined,
			{
				initialCwd: cwd,
				suppressBreadcrumb: true,
			},
		);
		const { session } = await this.createConversationSession(manager);
		try {
			const result = await session.handoff(input.instructions, {
				signal: input.signal,
			});
			const sessionRef = manager.getSessionFile();
			if (!result || !sessionRef) {
				throw new Error("OMP handoff did not create a new session");
			}
			return {
				sessionRef,
				handoffText: result.document,
			};
		} finally {
			await session.dispose();
		}
	}

	async runConversationTurn(
		input: ProviderConversationTurnInput,
	): Promise<ProviderConversationTurnResult> {
		const cwd = nonEmpty(this.config.cwd) ?? process.cwd();
		const manager =
			input.mode === "fork"
				? await SessionManager.forkFrom(input.sessionRef, cwd)
				: await SessionManager.open(input.sessionRef, undefined, undefined, {
						initialCwd: cwd,
						suppressBreadcrumb: true,
					});
		const { session } = await this.createConversationSession(manager);
		const chunks: string[] = [];
		let compacted = manager
			.getEntries()
			.some((entry) => entry.type === "compaction");
		const unsubscribe = session.subscribe((event) => {
			if (
				event.type === "message_update" &&
				event.assistantMessageEvent.type === "text_delta"
			) {
				chunks.push(event.assistantMessageEvent.delta);
			}
			if (event.type === "auto_compaction_end" && !event.aborted)
				compacted = true;
		});
		const abort = () => session.abort();
		input.signal?.addEventListener("abort", abort, { once: true });
		try {
			await session.prompt(input.prompt, { expandPromptTemplates: false });
			const usage = session.getContextUsage();
			return {
				sessionRef: manager.getSessionFile() ?? input.sessionRef,
				outputText: chunks.join("") || session.getLastAssistantText() || "",
				usage: usage
					? {
							inputTokens: usage.tokens,
							totalTokens: usage.tokens,
							contextWindow: usage.contextWindow,
						}
					: null,
				compacted,
			};
		} finally {
			input.signal?.removeEventListener("abort", abort);
			unsubscribe();
			await session.dispose();
		}
	}

	private async createConversationSession(sessionManager: SessionManager) {
		const environment = applySdkEnvironment(this.config);
		const cwd = nonEmpty(this.config.cwd) ?? process.cwd();
		const agentDir =
			nonEmpty(this.config.codingAgentDirectory) ??
			nonEmpty(this.config.configDirectory);
		const setup = await createSdkModelSetup(this.config, environment);
		const settings = await loadSdkSettings(environment, cwd);
		return createAgentSession({
			cwd,
			agentDir,
			modelPattern: setup.modelPattern,
			...(setup.authStorage ? { authStorage: setup.authStorage } : {}),
			...(setup.modelRegistry ? { modelRegistry: setup.modelRegistry } : {}),
			settings,
			sessionManager,
			skipPythonPreflight: true,
			hasUI: false,
			enableMCP: false,
			enableLsp: false,
			toolNames: [],
		});
	}

	async createSession(input?: CreateSessionInput): Promise<ProviderSessionRef> {
		const sessionId =
			input?.sessionKey ?? `${SDK_RUN_PREFIX}-session-${randomUUID()}`;
		return {
			provider: PROVIDER,
			sessionId,
			providerSessionId: sessionId,
			sessionKey: input?.sessionKey,
			createdAt: now(),
			raw: { mode: "sdk" },
		};
	}

	async startRun(input: StartRunInput): Promise<ProviderRunRef> {
		assertProviderStartSupported(this.getCapabilities(), input, this.provider);
		if (this.startedClientOperations.has(input.clientOperationId)) {
			throw new ProviderOperationError({
				code: "provider_start_outcome_unknown",
				provider: this.provider,
				message: `Oh My Pi cannot safely attach client operation ${input.clientOperationId}`,
			});
		}
		const sessionId = input.sessionId;
		const runId = `${SDK_RUN_PREFIX}-${randomUUID()}`;
		const startedAt = now();
		const handle: SdkRunHandle = {
			ref: {
				provider: PROVIDER,
				runId,
				sessionId,
				providerRunId: runId,
				providerResumeRef: input.resumeSessionRef ?? runId,
				status: "running",
				startedAt,
				stream: { supported: true, reconnectable: false },
				raw: { mode: "sdk" },
			},
			input,
			abort: new AbortController(),
			sessionId,
			status: "running",
			outputText: "",
			sequence: 0,
			queue: [],
			waiters: [],
			done: false,
			startedAt,
		};
		this.runs.set(runId, handle);

		const queue = new AsyncEventQueue(handle);
		this.startedClientOperations.add(input.clientOperationId);
		queue.push({
			...eventBase(handle, "run_started"),
			type: "run_started",
			run: runRef(handle),
		});
		this.startSdkTurn(handle, queue).catch((error) => {
			this.fail(handle, queue, error);
		});
		return handle.ref;
	}

	async *streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent> {
		const runId = "runId" in input ? input.runId : undefined;
		const handle = runId ? this.runs.get(runId) : undefined;
		if (!handle)
			throw new Error(`streamRun: unknown OMP SDK runId "${runId ?? ""}"`);
		const queue = new AsyncEventQueue(handle);
		for (;;) {
			const item = await queue.next(input.signal);
			if (item.type === "end") return;
			yield item;
		}
	}

	async getRun(input: GetRunInput): Promise<ProviderRunSnapshot> {
		const handle = this.runs.get(input.runId);
		if (handle) return this.snapshot(handle);
		const snapshot = this.terminalSnapshots.get(input.runId);
		if (snapshot) return snapshot;
		throw new Error(`getRun: unknown OMP SDK runId "${input.runId}"`);
	}

	async cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot> {
		const handle = this.runs.get(input.runId);
		if (!handle)
			throw new Error(`cancelRun: unknown OMP SDK runId "${input.runId}"`);
		const queue = new AsyncEventQueue(handle);
		handle.status = "cancelled";
		handle.abort.abort();
		handle.session?.abort();
		queue.push({
			...eventBase(handle, "cancelled"),
			type: "run_cancelled",
			run: runRef(handle, "cancelled"),
		});
		await this.finish(handle, queue);
		return this.snapshot(handle);
	}

	private snapshot(handle: SdkRunHandle): ProviderRunSnapshot {
		return {
			provider: PROVIDER,
			runId: handle.ref.runId,
			sessionId: handle.sessionId,
			nativeSessionId: handle.nativeSessionId,
			nativeRunId: handle.ref.nativeRunId,
			providerRunId: handle.ref.providerRunId,
			status: handle.status,
			rawStatus: handle.status,
			outputText: handle.outputText,
			output: { text: handle.outputText },
			structuredPayload: parseStructuredPayload(handle.outputText),
			terminalToolCall: handle.terminalAction
				? {
						name: handle.terminalAction.name,
						callId: handle.terminalAction.callId,
						input: handle.terminalAction.input,
					}
				: undefined,
			usage: null,
			error: handle.error ?? null,
			raw: { mode: "sdk" },
		};
	}

	private async startSdkTurn(handle: SdkRunHandle, queue: AsyncEventQueue) {
		if (handle.input.signal) {
			const abort = () => {
				if (handle.status !== "running") return;
				handle.status = "cancelled";
				handle.abort.abort();
				handle.session?.abort();
				queue.push({
					...eventBase(handle, "cancelled"),
					type: "run_cancelled",
					run: runRef(handle, "cancelled"),
				});
				void this.finish(handle, queue);
			};
			handle.inputAbortListener = abort;
			handle.input.signal.addEventListener("abort", abort, { once: true });
			if (handle.input.signal.aborted) abort();
		}
		if (sdkRunStopped(handle)) return;
		const environment = applySdkEnvironment(this.config, handle.ref.runId);
		const cwd = nonEmpty(this.config.cwd) ?? process.cwd();
		const agentDir =
			nonEmpty(this.config.codingAgentDirectory) ??
			nonEmpty(this.config.configDirectory);
		const terminalToolName = nonEmpty(handle.input.terminalToolName);
		const prompt = inputToPrompt(handle.input);
		const runConfig = withSdkRuntimeModel(
			this.config,
			handle.input.runtimeConfiguration?.model,
		);
		const setup = await createSdkModelSetup(runConfig, environment);
		if (sdkRunStopped(handle)) return;
		const settings = await loadSdkSettings(environment, cwd);
		if (sdkRunStopped(handle)) return;
		const resumeSessionRef = nonEmpty(handle.input.resumeSessionRef);
		const sessionManager = resumeSessionRef
			? await SessionManager.open(resumeSessionRef, undefined, undefined, {
					initialCwd: cwd,
					suppressBreadcrumb: true,
				})
			: SessionManager.create(cwd);
		const readOnlyToolOptions = sdkReadOnlyToolOptions(handle.input.toolPolicy);
		if (sdkRunStopped(handle)) return;
		const control = await connectChronaMcpControl({
			control: handle.input.control,
			sessionId: handle.input.sessionKey ?? handle.input.sessionId,
			cwd,
		});
		handle.mcpManager = control?.manager;
		if (sdkRunStopped(handle)) {
			await control?.manager.disconnectAll().catch(() => undefined);
			delete handle.mcpManager;
			return;
		}
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			modelPattern: sdkModelPatternForSession(
				setup.modelPattern,
				resumeSessionRef,
			),
			...(setup.authStorage ? { authStorage: setup.authStorage } : {}),
			...(setup.modelRegistry ? { modelRegistry: setup.modelRegistry } : {}),
			settings,
			...sdkRunToolOptions(
				handle.input.tools,
				terminalToolName,
				() => acceptTerminalAction(handle),
				control,
			),
			...readOnlyToolOptions,
			sessionManager,
			skipPythonPreflight: true,
			hasUI: false,
		});
		handle.session = session;
		if (sdkRunStopped(handle)) {
			await session.dispose().catch(() => undefined);
			return;
		}
		const expectedModel = nonEmpty(handle.input.runtimeConfiguration?.model);
		const actualModel = session.model
			? `${session.model.provider}/${session.model.id}`
			: null;
		try {
			assertExpectedModel(expectedModel, actualModel);
		} catch (error) {
			await session.dispose();
			throw error;
		}
		const persistedSessionRef = session.sessionManager.getSessionFile();
		if (persistedSessionRef) handle.nativeSessionId = persistedSessionRef;
		handle.unsubscribe = session.subscribe((event) =>
			this.onSessionEvent(handle, queue, event),
		);
		if (this.config.timeoutMs) {
			handle.timer = setTimeout(() => {
				if (handle.status !== "running") return;
				handle.error = `Oh My Pi SDK run timed out after ${this.config.timeoutMs}ms`;
				handle.status = "failed";
				session.abort();
				queue.push({
					...eventBase(handle, "timeout"),
					type: "run_failed",
					run: runRef(handle, "failed"),
					error: handle.error,
				});
				this.finish(handle, queue);
			}, this.config.timeoutMs);
		}

		const ran = await session.prompt(prompt, { expandPromptTemplates: false });
		if (!ran && !sdkRunStopped(handle)) {
			handle.status = "completed";
			queue.push({
				...eventBase(handle, "completed"),
				type: "run_completed",
				run: runRef(handle, "completed"),
				outputText: handle.outputText,
				output: { text: handle.outputText },
				structuredPayload: parseStructuredPayload(handle.outputText),
				usage: null,
				raw: { promptRan: false },
			});
			this.finish(handle, queue);
		}
	}

	private onSessionEvent(
		handle: SdkRunHandle,
		queue: AsyncEventQueue,
		event: AgentSessionEvent,
	) {
		if (handle.done) return;
		switch (event.type) {
			case "message_update": {
				const update = event.assistantMessageEvent;
				if (update.type === "text_delta") {
					handle.outputText += update.delta;
					queue.push({
						...eventBase(handle, update.type),
						type: "text_delta",
						text: update.delta,
					});
				} else if (update.type === "thinking_delta") {
					queue.push({
						...eventBase(handle, update.type),
						type: "reasoning_delta",
						text: update.delta,
						raw: update,
					});
				} else if (update.type === "error") {
					this.fail(handle, queue, update.reason);
				}
				break;
			}
			case "tool_execution_start":
				if (isRunTerminalTool(handle.input, event.toolName)) {
					handle.terminalAction = {
						name: event.toolName,
						callId: event.toolCallId,
						input: asRecord(event.args),
					};
				}
				queue.push({
					...eventBase(handle, event.type),
					type: "tool_call",
					tool: event.toolName,
					callId: event.toolCallId,
					input: asRecord(event.args),
					status: "pending",
					preview: toolCallPreview(event),
				});
				break;
			case "tool_execution_update":
				queue.push({
					...eventBase(handle, event.type),
					type: "tool_progress",
					toolName: event.toolName,
					callId: event.toolCallId,
					preview: textContentPreview(event.partialResult),
				});
				break;
			case "tool_execution_end":
				queue.push({
					...eventBase(handle, event.type),
					type: "tool_completed",
					toolName: event.toolName,
					callId: event.toolCallId,
					error: event.isError
						? { message: sdkToolErrorMessage(event.result), raw: event.result }
						: undefined,
					raw: event.result,
				});
				queue.push({
					...eventBase(handle, `${event.type}:result`),
					type: "tool_result",
					tool: event.toolName,
					callId: event.toolCallId,
					result: event.result,
				});
				break;
			case "turn_start":
			case "turn_end":
			case "auto_compaction_start":
			case "auto_compaction_end":
			case "auto_retry_start":
			case "auto_retry_end":
			case "retry_fallback_applied":
			case "retry_fallback_succeeded":
			case "notice":
			case "todo_reminder":
			case "todo_auto_clear":
			case "thinking_level_changed": {
				const message = sdkLifecycleSummary(event);
				if (message)
					queue.push({
						...eventBase(handle, event.type),
						type: "raw_event",
						raw: { message },
					});
				break;
			}
			case "agent_end": {
				if (handle.status !== "running") break;
				const outcome = agentEndOutcome(
					event,
					handle.terminalActionAccepted === true,
				);
				if (outcome.status === "failed") {
					handle.error = outcome.error;
					handle.status = "failed";
					queue.push({
						...eventBase(handle, event.type),
						type: "run_failed",
						run: runRef(handle, "failed"),
						error: outcome.error,
						raw: event,
					});
					this.finish(handle, queue);
					break;
				}
				handle.status = "completed";
				queue.push({
					...eventBase(handle, event.type),
					type: "run_completed",
					run: runRef(handle, "completed"),
					outputText: handle.outputText,
					output: { text: handle.outputText },
					terminalToolCall: handle.terminalAction
						? {
								name: handle.terminalAction.name,
								callId: handle.terminalAction.callId,
								input: handle.terminalAction.input,
							}
						: undefined,
					usage: null,
					raw: terminalToolFromSnapshot({
						raw: handle.terminalAction
							? { terminalTool: handle.terminalAction }
							: undefined,
						terminalToolName: handle.input.terminalToolName,
						tools: handle.input.tools,
					})
						? { ...asRecord(event), terminalTool: handle.terminalAction }
						: event,
				});
				this.finish(handle, queue);
				break;
			}
			default:
				break;
		}
	}

	private fail(handle: SdkRunHandle, queue: AsyncEventQueue, error: unknown) {
		if (handle.done) return;
		handle.status = handle.abort.signal.aborted ? "cancelled" : "failed";
		if (handle.status === "cancelled") {
			queue.push({
				...eventBase(handle, "cancelled"),
				type: "run_cancelled",
				run: runRef(handle, "cancelled"),
			});
		} else {
			handle.error = error instanceof Error ? error.message : String(error);
			queue.push({
				...eventBase(handle, "error"),
				type: "run_failed",
				run: runRef(handle, "failed"),
				error: handle.error,
			});
		}
		this.finish(handle, queue);
	}

	private async finish(
		handle: SdkRunHandle,
		queue: AsyncEventQueue,
	): Promise<void> {
		if (handle.done) return;
		handle.done = true;
		clearTimeout(handle.timer);
		if (handle.input.signal && handle.inputAbortListener) {
			handle.input.signal.removeEventListener(
				"abort",
				handle.inputAbortListener,
			);
		}
		handle.unsubscribe?.();
		this.runs.delete(handle.ref.runId);
		this.terminalSnapshots.set(this.snapshot(handle));
		try {
			await handle.session?.dispose();
		} catch (error) {
			log.warn("sdk.session_disposal_failed", { error: serializeSafeError(error) });
		}
		try {
			await handle.mcpManager?.disconnectAll();
		} catch (error) {
			log.warn("sdk.mcp_disposal_failed", { error: serializeSafeError(error) });
		}
		queue.push({ type: "end" });
	}
}
