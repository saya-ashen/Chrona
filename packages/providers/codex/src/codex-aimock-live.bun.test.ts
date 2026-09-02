import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LLMock } from "@copilotkit/aimock";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
	LIVE_PROVIDER_SMOKE_MARKER,
	runLiveProviderSmoke,
} from "@chrona/providers-foundation";

import { CodexProviderClient } from "./index";

const RUN_LIVE_CODEX_TESTS = process.env.CHRONA_RUN_LIVE_CODEX_TESTS === "1";
const TEST_TIMEOUT_MS = 120_000;

function startMcpServer() {
	const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
	const http = Bun.serve({
		port: 0,
		async fetch(request) {
			if (new URL(request.url).pathname !== "/api/mcp") {
				return new Response("Not found", { status: 404 });
			}
			const sessionId = request.headers.get("mcp-session-id");
			if (sessionId) {
				const transport = transports.get(sessionId);
				return transport
					? transport.handleRequest(request)
					: new Response("Unknown MCP session", { status: 404 });
			}
			const transport: WebStandardStreamableHTTPServerTransport =
				new WebStandardStreamableHTTPServerTransport({
					enableJsonResponse: true,
					sessionIdGenerator: randomUUID,
					onsessioninitialized: (id): void => {
						transports.set(id, transport);
					},
				});
			transport.onclose = () => {
				if (transport.sessionId) transports.delete(transport.sessionId);
			};
			const mcp = new McpServer({ name: "codex-provider-test", version: "1.0.0" });
			mcp.registerTool("fixture_status", {}, async () => ({
				content: [{ type: "text", text: "ready" }],
			}));
			await mcp.connect(transport);
			return transport.handleRequest(request);
		},
	});
	return {
		url: `http://127.0.0.1:${http.port}`,
		stop: async () => {
			for (const transport of transports.values()) await transport.close();
			http.stop(true);
		},
	};
}

describe.skipIf(!RUN_LIVE_CODEX_TESTS)("Codex custom upstream protocol conformance", () => {
	it("runs the real Codex ACP binary against an OpenAI Responses-compatible endpoint", async () => {
		const mock = new LLMock({ port: 0 });
		mock.onMessage(/CHRONA_ACP_HEALTH_OK/, { content: "CHRONA_ACP_HEALTH_OK" });
		mock.onMessage(/CHRONA_PROVIDER_SMOKE_OK/, {
			content: LIVE_PROVIDER_SMOKE_MARKER,
		});
		await mock.start();
		const mcp = startMcpServer();
		const cwd = mkdtempSync(join(tmpdir(), "chrona-codex-aimock-"));
		try {
			const client = new CodexProviderClient({
				config: {
					model: "gpt-5-codex",
					baseUrl: `${mock.url}/v1`,
					apiKey: "mock-codex-key",
					cwd,
					mcpBaseUrl: mcp.url,
					timeoutMs: 60_000,
					initialAgentMode: "read-only",
				},
			});
			const result = await runLiveProviderSmoke(client, {
				timeoutMs: 60_000,
			});

			expect(result.status, result.error ?? "Codex smoke failed").toBe("passed");
			expect(result.health.ok).toBe(true);
			expect(result.capabilities.matched).toBe(true);
			expect(result.run?.terminalType).toBe("run_completed");
			expect(result.run?.outputMarkerMatched).toBe(true);

			mock.onMessage(/SAFE_FEATURE_REQUEST/, { content: "SAFE_FEATURE_OK" });
			const safeRun = await client.startRun({
				clientOperationId: "codex-safe-feature",
				sessionId: "codex-safe-feature-session",
				instructions: "Return SAFE_FEATURE_OK without side effects.",
				input: { type: "text", text: "SAFE_FEATURE_REQUEST" },
				toolPolicy: "terminal_only",
				stream: true,
			});
			const safeEvents = await Array.fromAsync(client.streamRun({ runId: safeRun.runId }));
			expect(safeEvents.at(-1)).toMatchObject({
				type: "run_completed",
				outputText: expect.stringContaining("SAFE_FEATURE_OK"),
			});
		} finally {
			await mock.stop();
			await mcp.stop();
			rmSync(cwd, { recursive: true, force: true });
		}
	}, TEST_TIMEOUT_MS);
});
