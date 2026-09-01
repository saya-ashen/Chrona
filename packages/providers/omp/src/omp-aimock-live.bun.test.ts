import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LLMock } from "@copilotkit/aimock";
import {
	LIVE_PROVIDER_SMOKE_MARKER,
	runLiveProviderSmoke,
} from "@chrona/providers-foundation";

import { OmpProviderClient } from "./index";
import type { OmpProviderConfig } from "./types";

const RUN_LIVE_OMP_TESTS = process.env.CHRONA_RUN_LIVE_OMP_TESTS === "1";
const TEST_TIMEOUT_MS = 120_000;
const PROTOCOLS: Array<{
	api: NonNullable<OmpProviderConfig["api"]>;
	basePath: string;
}> = [
	{ api: "openai-responses", basePath: "/v1" },
	{ api: "openai-completions", basePath: "/v1" },
	{ api: "anthropic-messages", basePath: "" },
	{ api: "openrouter", basePath: "/api/v1" },
];

describe.skipIf(!RUN_LIVE_OMP_TESTS)("OMP custom upstream protocol conformance", () => {
	it("runs the real OMP SDK against every user-selectable wire protocol", async () => {
		const mock = new LLMock({ port: 0 });
		mock.on({}, { content: LIVE_PROVIDER_SMOKE_MARKER });
		await mock.start();
		try {
			for (const protocol of PROTOCOLS) {
				const cwd = mkdtempSync(join(tmpdir(), `chrona-omp-${protocol.api}-`));
				try {
					const client = new OmpProviderClient({
						config: {
							provider: `aimock-${protocol.api}`,
							model: "test-model",
							api: protocol.api,
							baseUrl: `${mock.url}${protocol.basePath}`,
							apiKey: "mock-omp-key",
							cwd,
							timeoutMs: 60_000,
						},
					});
					const result = await runLiveProviderSmoke(client, {
						timeoutMs: 60_000,
					});

					expect(result.status, `${protocol.api}: ${result.error ?? "failed"}`).toBe(
						"passed",
					);
					expect(result.health.ok).toBe(true);
					expect(result.run?.outputMarkerMatched).toBe(true);
				} finally {
					rmSync(cwd, { recursive: true, force: true });
				}
			}
		} finally {
			await mock.stop();
		}
	}, TEST_TIMEOUT_MS);
});
