import { Hono, type Context } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type {
	CallToolResult,
	ServerNotification,
	ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
	validateRevokedRunToken,
	validateRunToken,
	type ChronaEngine,
	type RunTokenScope,
} from "@chrona/engine";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createLogger } from "@chrona/logging";
import { z } from "zod";
import {
	chronaPublicToolPayloadSchemas,
	chronaToolInputSchema,
	type ChronaToolName,
	type ChronaToolResult,
} from "@chrona/contracts";

const MAX_MCP_TRANSPORT_SESSIONS = 100;
const MCP_TRANSPORT_IDLE_TTL_MS = 10 * 60 * 1_000;
type McpRunTokenScope = Pick<
	RunTokenScope,
	"taskId" | "workspaceId" | "taskSessionId" | "runId" | "runtimeSessionKey"
>;
type McpAuthKind = "local" | "api-key" | "run-token";
type McpAuthIdentity = {
	kind: McpAuthKind;
	credentialDigest: string;
	runTokenScope?: McpRunTokenScope;
};
type ManagedTransport = {
	transport: WebStandardStreamableHTTPServerTransport;
	lastActivityAt: number;
	auth: McpAuthIdentity;
};
type McpRouteOptions = { apiKey?: string };

function closeManagedTransport(
	transports: Map<string, ManagedTransport>,
	sessionId: string,
	reason: "idle" | "closed" | "aborted" | "capacity",
) {
	const entry = transports.get(sessionId);
	if (!entry) return;
	transports.delete(sessionId);
	logger.info("mcp.transport.closed", {
		sessionId,
		reason,
		activeSessions: transports.size,
	});
	void entry.transport.close().catch((cause: unknown) => {
		logger.warn("mcp.transport.close_failed", {
			sessionId,
			reason,
			error: cause instanceof Error ? cause.message : String(cause),
		});
	});
}

function evictExpiredTransports(
	transports: Map<string, ManagedTransport>,
	now = Date.now(),
) {
	for (const [sessionId, entry] of transports) {
		if (now - entry.lastActivityAt > MCP_TRANSPORT_IDLE_TTL_MS) {
			closeManagedTransport(transports, sessionId, "idle");
		}
	}
}

function bearerToken(authorization: string | undefined): string | undefined {
	const match = authorization?.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || undefined;
}

function credentialDigest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function sameMcpRunTokenScope(left: McpRunTokenScope, right: McpRunTokenScope): boolean {
	return left.taskId === right.taskId
		&& left.workspaceId === right.workspaceId
		&& left.taskSessionId === right.taskSessionId
		&& left.runId === right.runId
		&& left.runtimeSessionKey === right.runtimeSessionKey;
}

function toMcpRunTokenScope(scope: RunTokenScope): McpRunTokenScope {
	return {
		taskId: scope.taskId,
		workspaceId: scope.workspaceId,
		taskSessionId: scope.taskSessionId,
		runId: scope.runId,
		runtimeSessionKey: scope.runtimeSessionKey,
	};
}

function matchesCredential(provided: string | undefined, expected: string): boolean {
	if (!provided) return false;
	const left = Buffer.from(provided);
	const right = Buffer.from(expected);
	return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

async function resolveMcpAuthIdentity(
	authorization: string | undefined,
	apiKey: string | undefined,
): Promise<McpAuthIdentity | undefined> {
	const token = bearerToken(authorization);
	if (apiKey && matchesCredential(token, apiKey)) {
		return { kind: "api-key", credentialDigest: credentialDigest(apiKey) };
	}
	if (!token) return apiKey ? undefined : { kind: "local", credentialDigest: "local" };
	const scope = await validateRunToken(token);
	return scope
		? {
			kind: "run-token",
			credentialDigest: credentialDigest(token),
			runTokenScope: toMcpRunTokenScope(scope),
		}
		: undefined;
}

function sameMcpAuthIdentity(left: McpAuthIdentity, right: McpAuthIdentity): boolean {
	return left.kind === right.kind
		&& left.credentialDigest === right.credentialDigest
		&& (left.kind !== "run-token"
			|| (left.runTokenScope !== undefined
				&& right.runTokenScope !== undefined
				&& sameMcpRunTokenScope(left.runTokenScope, right.runTokenScope)));
}

async function isRevokedTransportClose(
	method: string,
	authorization: string | undefined,
	auth: McpAuthIdentity,
): Promise<boolean> {
	if (method !== "DELETE" || auth.kind !== "run-token") return false;
	const token = bearerToken(authorization);
	if (!token || credentialDigest(token) !== auth.credentialDigest) return false;
	const scope = await validateRevokedRunToken(token);
	return Boolean(scope && auth.runTokenScope && sameMcpRunTokenScope(auth.runTokenScope, toMcpRunTokenScope(scope)));
}

type ExternalChronaToolName = keyof typeof externalTools;

const FEATURE_TERMINAL_TOOL_NAME = "chrona_feature_complete";

const logger = createLogger("apps.server.mcp");

const hiddenContextKeys = new Set([
	"workspaceId",
	"taskId",
	"sessionId",
	"actorType",
	"actorId",
	"idempotencyKey",
	"expectedState",
	"expectedRevision",
	"evidence",
	"_meta",
]);

function publicToolSchema(schema: z.ZodObject) {
	const visibleKeys = new Set(Object.keys(schema.shape));
	return schema.passthrough().superRefine((value, ctx) => {
		const unrecognizedKeys = Object.keys(value).filter(
			(key) => !visibleKeys.has(key) && !hiddenContextKeys.has(key),
		);

		if (unrecognizedKeys.length === 0) return;

		ctx.addIssue({
			code: z.ZodIssueCode.unrecognized_keys,
			keys: unrecognizedKeys,
			message: `Unrecognized key${unrecognizedKeys.length === 1 ? "" : "s"}: ${unrecognizedKeys.map((key) => `"${key}"`).join(", ")}`,
		});
	});
}

const externalTools = {
	chrona_execution_read: {
		internalName: "chrona.execution.read",
		title: "Chrona Execution Read",
		description: "Read execution session state and supported next actions.",
		inputSchema: publicToolSchema(
			chronaPublicToolPayloadSchemas["chrona.execution.read"],
		),
	},
	chrona_goal_results_read: {
		internalName: "chrona.goal.results.read",
		title: "Chrona Goal Results Read",
		description:
			"Search bounded metadata for current approved Goal assets and immutable accepted-result history, or read one approved asset body by opaque ref. Use offset and maxChars to continue long asset reads. Chrona resolves Goal scope from the session; catalog refs expose no backend identity.",
		inputSchema: publicToolSchema(
			chronaPublicToolPayloadSchemas["chrona.goal.results.read"],
		),
	},
	chrona_plan_read: {
		internalName: "chrona.plan.read",
		title: "Chrona Plan Read",
		description: "Read accepted plan state through AI-visible refs.",
		inputSchema: publicToolSchema(
			chronaPublicToolPayloadSchemas["chrona.plan.read"],
		),
	},
	chrona_node_read: {
		internalName: "chrona.node.read",
		title: "Chrona Node Read",
		description:
			"Read current execution state, or read bounded semantic result content for one AI-visible node ref. Use offset and maxChars to continue long result reads.",
		inputSchema: publicToolSchema(
			chronaPublicToolPayloadSchemas["chrona.node.read"],
		),
	},
	chrona_node_complete: {
		internalName: "chrona.node.complete",
		title: "Chrona Node Complete",
		description:
			"Complete the current task node after required outputs have been submitted.",
		inputSchema: publicToolSchema(
			chronaPublicToolPayloadSchemas["chrona.node.complete"],
		),
	},
	chrona_condition_select: {
		internalName: "chrona.node.condition_select",
		title: "Chrona Condition Select",
		description:
			"Select a condition branch by nodeId and branchRef. Chrona validates the node against the current task.",
		inputSchema: publicToolSchema(
			chronaPublicToolPayloadSchemas["chrona.node.condition_select"],
		),
	},
	chrona_node_block: {
		internalName: "chrona.node.block",
		title: "Chrona Node Block",
		description:
			"Block the current node when it needs user input or an unavailable capability. Provide a reason and an actionForm (instructions plus at least one input field) describing what the user must supply to unblock. Chrona resolves the active node from the session.",
		inputSchema: publicToolSchema(
			chronaPublicToolPayloadSchemas["chrona.node.block"],
		),
	},
	chrona_node_fail: {
		internalName: "chrona.node.fail",
		title: "Chrona Node Fail",
		description:
			"Fail the current node with an unrecoverable error. Chrona resolves the active node from the session.",
		inputSchema: publicToolSchema(
			chronaPublicToolPayloadSchemas["chrona.node.fail"],
		),
	},
	chrona_wait_complete: {
		internalName: "chrona.node.wait_complete",
		title: "Chrona Wait Complete",
		description:
			"Complete the current wait node when the wait condition is explicitly satisfied.",
		inputSchema: publicToolSchema(
			chronaPublicToolPayloadSchemas["chrona.node.wait_complete"],
		),
	},
} as const satisfies Record<
	string,
	{
		internalName: ChronaToolName;
		title: string;
		description: string;
		inputSchema: z.ZodObject;
	}
>;

function sessionIdFrom(
	input: Record<string, unknown>,
	extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
	requestSessionId?: string,
) {
	const meta = objectRecord(input._meta);
	const extraMeta = objectRecord(extra?._meta);
	assertNoSnakeSessionIds([
		[input, "arguments"],
		[meta, "arguments._meta"],
		[extraMeta, "extra._meta"],
	]);
	assertValidSessionIds([
		[requestSessionId, "request.session_id"],
		[input.sessionId, "arguments.sessionId"],
		[meta?.sessionId, "arguments._meta.sessionId"],
		[extraMeta?.sessionId, "extra._meta.sessionId"],
		[extra?.sessionId, "extra.sessionId"],
	]);
	const sessionId =
		requestSessionId ?? sessionIdFromInput(input, meta, extraMeta, extra);
	return typeof sessionId === "string" && sessionId.length > 0
		? sessionId
		: undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === "object")
		return value as Record<string, unknown>;
	return undefined;
}

function assertNoSnakeSessionIds(
	sources: readonly (readonly [Record<string, unknown> | undefined, string])[],
) {
	for (const [input, source] of sources) {
		if (input) assertNoSnakeSessionId(input, source);
	}
}

function assertValidSessionIds(
	sources: readonly (readonly [unknown, string])[],
) {
	for (const [value, source] of sources) {
		assertValidSessionId(value, source);
	}
}

function sessionIdFromInput(
	input: Record<string, unknown>,
	meta: Record<string, unknown> | undefined,
	extraMeta: Record<string, unknown> | undefined,
	extra: RequestHandlerExtra<ServerRequest, ServerNotification> | undefined,
) {
	if (typeof input.sessionId === "string") return input.sessionId;
	return meta?.sessionId ?? extraMeta?.sessionId ?? extra?.sessionId;
}

function assertNoSnakeSessionId(
	input: Record<string, unknown>,
	source: string,
) {
	if (Object.prototype.hasOwnProperty.call(input, "session_id")) {
		throw new Error(
			`${source}.session_id is not supported; expected sessionId`,
		);
	}
}

function assertValidSessionId(value: unknown, source: string) {
	if (value === undefined || value === null) return;
	if (
		typeof value !== "string" ||
		value.trim().length === 0 ||
		value === "unknown"
	) {
		throw new Error(`${source} is invalid`);
	}
}

function metaFrom(
	input: Record<string, unknown>,
	extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
) {
	const inputMeta =
		input._meta && typeof input._meta === "object"
			? (input._meta as Record<string, unknown>)
			: {};
	const extraMeta =
		extra?._meta && typeof extra._meta === "object"
			? (extra._meta as Record<string, unknown>)
			: {};
	return { ...extraMeta, ...inputMeta };
}

function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableJson).join(",")}]`;
	}
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
		.join(",")}}`;
}

function idempotencyKeyFrom(
	input: Record<string, unknown>,
	toolName: ChronaToolName,
	payload: Record<string, unknown>,
	extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
	requestSessionId?: string,
) {
	if (!toolName.endsWith(".read")) {
		const meta = metaFrom(input, extra);
		const explicitKey =
			meta.idempotencyKey ??
			meta.requestId ??
			meta.callId ??
			input.idempotencyKey;
		if (typeof explicitKey === "string" && explicitKey.length > 0) {
			return explicitKey;
		}
		const sessionId = sessionIdFrom(input, extra, requestSessionId);
		if (!sessionId) {
			throw new Error(`${toolName} requires sessionId for idempotency`);
		}
		const hash = createHash("sha256")
			.update(stableJson({ sessionId, toolName, payload }))
			.digest("hex")
			.slice(0, 24);
		return `${toolName}:${hash}`;
	}
	return undefined;
}

function aiVisibleToolResult(
	toolName: ChronaToolName,
	result: ChronaToolResult,
): Record<string, unknown> {
	if (result.status === "accepted") {
		if (toolName === "chrona.goal.results.read") {
			return {
				status: result.status,
				message: result.message,
				result: result.state.result,
			};
		}
		if (toolName.endsWith(".read"))
			return {
				status: result.status,
				message: result.message,
				state: result.state,
			};
		return { status: result.status, message: result.message, next: "stop" };
	}

	return {
		status: result.status,
		message: result.message,
		reasonCode: result.reasonCode,
		recovery: result.recovery,
		...(result.evidence ? { evidence: result.evidence } : {}),
	};
}

function aiVisibleToolText(
	toolName: ChronaToolName,
	result: ChronaToolResult,
): string {
	if (result.status === "accepted" && toolName.endsWith(".read")) {
		return JSON.stringify(aiVisibleToolResult(toolName, result));
	}
	const issues = Array.isArray(result.recovery?.details?.issues)
		? result.recovery.details.issues
		: [];
	if (issues.length === 0) return result.message;

	const issueText = issues
		.map((issue) => {
			if (!issue || typeof issue !== "object") return null;
			const path =
				"path" in issue && typeof issue.path === "string" ? issue.path : null;
			const message =
				"message" in issue && typeof issue.message === "string"
					? issue.message
					: null;
			if (!path && !message) return null;
			return path && message ? `${path}: ${message}` : (path ?? message);
		})
		.filter((issue): issue is string => Boolean(issue));
	if (issueText.length === 0) return result.message;

	return `${result.message}\nValidation issues:\n${issueText.map((issue) => `- ${issue}`).join("\n")}`;
}

function toChronaInput(
	toolName: ChronaToolName,
	input: Record<string, unknown>,
	extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
	requestSessionId?: string,
) {
	const payload = { ...input };
	for (const key of hiddenContextKeys) {
		delete payload[key];
	}
	const meta = metaFrom(input, extra);
	const expectedRevision =
		typeof meta.expectedRevision === "number"
			? meta.expectedRevision
			: undefined;
	const evidence =
		meta.evidence && typeof meta.evidence === "object"
			? (meta.evidence as Record<string, unknown>)
			: undefined;
	const validatedPayload = chronaPublicToolPayloadSchemas[toolName].parse(payload);
	return {
		sessionId: sessionIdFrom(input, extra, requestSessionId),
		actorType: "agent" as const,
		idempotencyKey: idempotencyKeyFrom(
			input,
			toolName,
			payload,
			extra,
			requestSessionId,
		),
		expectedRevision,
		evidence,
		payload: validatedPayload,
	};
}

function isToolAllowedForSession(toolName: ChronaToolName): boolean {
	return toolName.endsWith(".read");
}

function toolNotAllowedResult(toolName: ChronaToolName): CallToolResult {
	const message = `${toolName} requires a persisted active capability session.`;
	return {
		content: [{ type: "text", text: message }],
		structuredContent: {
			status: "rejected",
			message,
			reasonCode: "UNAUTHORIZED",
			recovery: { action: "use_allowed_tool" },
		},
		isError: true,
	};
}

async function callChronaTool(
	engine: ChronaEngine,
	toolName: ChronaToolName,
	input: Record<string, unknown>,
	extra?: RequestHandlerExtra<ServerRequest, ServerNotification>,
	requestSessionId?: string,
): Promise<CallToolResult> {
	const chronaInput = toChronaInput(toolName, input, extra, requestSessionId);
	let resolvedInput;
	try {
		resolvedInput =
			"resolveInputContext" in engine.agentTools
				? await engine.agentTools.resolveInputContext(chronaInput, toolName)
				: chronaToolInputSchema.parse(chronaInput);
	} catch (cause) {
		const message =
			cause instanceof Error
				? cause.message
				: "Chrona rejected the mutation session.";
		logger.warn("tool.call.rejected_by_session_policy", { toolName, message });
		return toolNotAllowedResult(toolName);
	}
	if (!isToolAllowedForSession(toolName) && !resolvedInput.sessionId) {
		return toolNotAllowedResult(toolName);
	}
	const result = await engine.agentTools.execute({
		toolName,
		input: resolvedInput,
	});
	return {
		content: [{ type: "text", text: aiVisibleToolText(toolName, result) }],
		structuredContent: aiVisibleToolResult(toolName, result),
		isError: result.status === "rejected",
	};
}

function createChronaMcpServer(
	engine: ChronaEngine,
	requestSessionId?: string,
	terminalOnly = false,
) {
	const server = new McpServer({ name: "chrona", version: "0.1.0" });

	if (terminalOnly) {
		server.registerTool(
			FEATURE_TERMINAL_TOOL_NAME,
			{
				title: "Chrona Feature Complete",
				description:
					"Submit the authoritative structured result for the current Chrona feature run.",
				inputSchema: { result: z.record(z.string(), z.unknown()) },
				annotations: {
					readOnlyHint: true,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
			},
			async () => ({
				content: [
					{
						type: "text",
						text: "Chrona accepted the feature terminal result.",
					},
				],
			}),
		);
		return server;
	}

	for (const [externalName, tool] of Object.entries(externalTools) as [
		ExternalChronaToolName,
		(typeof externalTools)[ExternalChronaToolName],
	][]) {
		const toolName = tool.internalName;
		server.registerTool(
			externalName,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema,
				annotations: {
					readOnlyHint: toolName.endsWith(".read"),
					destructiveHint: false,
					idempotentHint: !toolName.endsWith(".read"),
					openWorldHint: false,
				},
			},
			(
				input: unknown,
				extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
			) =>
				callChronaTool(
					engine,
					toolName,
					input as Record<string, unknown>,
					extra,
					requestSessionId,
				),
		);
	}

	return server;
}

export const __mcpRouteTestHooks = {
	externalTools,
	callChronaTool,
	createChronaMcpServer,
	sessionIdFrom,
	toChronaInput,
};

async function handleExistingMcpTransport(
	c: Context,
	transports: Map<string, ManagedTransport>,
	sessionId: string,
	transport: ManagedTransport,
	auth: McpAuthIdentity | undefined,
): Promise<Response> {
	if (!auth || !sameMcpAuthIdentity(transport.auth, auth)) {
		if (await isRevokedTransportClose(c.req.method, c.req.header("authorization"), transport.auth)) {
			closeManagedTransport(transports, sessionId, "closed");
			return c.body(null, 204);
		}
		return c.json({ error: "MCP credentials do not own this session." }, 401);
	}
	transport.lastActivityAt = Date.now();
	if (c.req.raw.signal.aborted) {
		closeManagedTransport(transports, sessionId, "aborted");
		return c.body(null, 408);
	}
	return transport.transport.handleRequest(c.req.raw);
}

export function createMcpRoutes(engine: ChronaEngine, options: McpRouteOptions = {}) {
	const app = new Hono();
	const transports = new Map<string, ManagedTransport>();

	app.all("/mcp", async (c) => {
		evictExpiredTransports(transports);
		const auth = await resolveMcpAuthIdentity(c.req.header("authorization"), options.apiKey);
		const mcpSessionId = c.req.header("mcp-session-id");
		const existingTransport = mcpSessionId
			? transports.get(mcpSessionId)
			: undefined;
		if (existingTransport) {
			return handleExistingMcpTransport(c, transports, mcpSessionId!, existingTransport, auth);
		}
		if (!auth) {
			return c.json({ error: "Missing or invalid MCP credentials." }, 401);
		}
		if (mcpSessionId) {
			return c.json({ error: "Unknown or expired MCP session." }, 404);
		}
		if (transports.size >= MAX_MCP_TRANSPORT_SESSIONS) {
			logger.warn("mcp.transport.capacity_rejected", {
				activeSessions: transports.size,
				maxSessions: MAX_MCP_TRANSPORT_SESSIONS,
			});
			return c.json({ error: "MCP transport session capacity reached." }, 503);
		}

		const requestSessionId =
			c.req.query("session_id") ?? c.req.query("sessionId") ?? undefined;
		if (auth.kind === "run-token" && requestSessionId !== auth.runTokenScope?.runtimeSessionKey) {
			return c.json({ error: "Run token does not own this MCP session." }, 401);
		}
		const terminalOnly = c.req.query("terminal_only") === "1";
		const transport = new WebStandardStreamableHTTPServerTransport({
			enableJsonResponse: true,
			sessionIdGenerator: randomUUID,
			onsessioninitialized: (sessionId) => {
				transports.set(sessionId, {
					transport,
					lastActivityAt: Date.now(),
					auth,
				});
				logger.info("mcp.transport.opened", {
					sessionId,
					activeSessions: transports.size,
				});
			},
			onsessionclosed: (sessionId) => {
				if (sessionId) closeManagedTransport(transports, sessionId, "closed");
			},
		});
		transport.onclose = () => {
			if (transport.sessionId)
				closeManagedTransport(transports, transport.sessionId, "closed");
		};
		const abort = () => {
			if (transport.sessionId)
				closeManagedTransport(transports, transport.sessionId, "aborted");
		};
		c.req.raw.signal.addEventListener("abort", abort, { once: true });
		const server = createChronaMcpServer(
			engine,
			requestSessionId,
			terminalOnly,
		);
		await server.connect(transport);
		return transport.handleRequest(c.req.raw);
	});
	return app;
}
