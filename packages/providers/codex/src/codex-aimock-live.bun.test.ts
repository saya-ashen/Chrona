import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LLMock } from "@copilotkit/aimock";
import {
	LIVE_PROVIDER_SMOKE_MARKER,
	runLiveProviderSmoke,
} from "@chrona/providers-foundation";

import { CodexProviderClient } from "./index";

const RUN_LIVE_CODEX_TESTS = process.env.CHRONA_RUN_LIVE_CODEX_TESTS === "1";
const TEST_TIMEOUT_MS = 120_000;

describe.skipIf(!RUN_LIVE_CODEX_TESTS)("Codex custom upstream protocol conformance", () => {
	it("runs the real Codex ACP binary against an OpenAI Responses-compatible endpoint", async () => {
		const mock = new LLMock({ port: 0 });
		mock.onMessage(/CHRONA_ACP_HEALTH_OK/, { content: "CHRONA_ACP_HEALTH_OK" });
		mock.onMessage(/CHRONA_PROVIDER_SMOKE_OK/, {
			content: LIVE_PROVIDER_SMOKE_MARKER,
		});
		await mock.start();
		const cwd = mkdtempSync(join(tmpdir(), "chrona-codex-aimock-"));
		try {
			const client = new CodexProviderClient({
				config: {
					model: "gpt-5-codex",
					baseUrl: `${mock.url}/v1`,
					apiKey: "mock-codex-key",
					cwd,
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
		} finally {
			await mock.stop();
			rmSync(cwd, { recursive: true, force: true });
		}
	}, TEST_TIMEOUT_MS);
});
