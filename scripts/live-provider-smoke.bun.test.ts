import { describe, expect, it } from "bun:test";

import {
	parseLiveProviderSmokeArgs,
	sharedClaudeConfigFromOmp,
	sharedCodexConfigFromOmp,
} from "./live-provider-smoke";

describe("live provider smoke CLI", () => {
	it("selects released providers by default and keeps Hermes hidden", () => {
		expect(parseLiveProviderSmokeArgs([]).providers).toEqual([
			"debug",
			"codex",
			"omp",
			"claude_code",
		]);
	});

	it("accepts a bounded provider subset and explicit release options", () => {
		expect(
			parseLiveProviderSmokeArgs([
				"--provider",
				"omp,claude_code",
				"--allow-missing",
				"--reuse-omp-for-claude",
				"--reuse-omp-for-codex",
				"--timeout-ms",
				"90000",
				"--chrona-base-url",
				"http://127.0.0.1:4101/",
				"--report",
				".chrona/custom-provider-report.json",
			]),
		).toEqual({
			providers: ["omp", "claude_code"],
			timeoutMs: 90_000,
			allowMissing: true,
			reuseOmpForClaude: true,
			reuseOmpForCodex: true,
			listOnly: false,
			chronaBaseUrl: "http://127.0.0.1:4101",
			reportPath: ".chrona/custom-provider-report.json",
		});
	});

	it("derives an isolated Anthropic-compatible Claude configuration from an OMP gateway", () => {
		expect(
			sharedClaudeConfigFromOmp(
				{
					baseUrl: "https://gateway.example/v1",
					apiKey: "gateway-key",
					model: "shared-model",
				},
				"/tmp/isolated-claude",
			),
		).toEqual({
			model: "shared-model",
			apiKey: "gateway-key",
			configDirectory: "/tmp/isolated-claude",
			env: {
				ANTHROPIC_BASE_URL: "https://gateway.example",
				ANTHROPIC_API_KEY: "gateway-key",
				ANTHROPIC_AUTH_TOKEN: "gateway-key",
				CLAUDE_CONFIG_DIR: "/tmp/isolated-claude",
				DISABLE_OMC: "1",
				OMC_SKIP_HOOKS: "1",
			},
		});
		expect(() =>
			sharedClaudeConfigFromOmp(
				{ apiKey: "gateway-key", model: "shared-model" },
				"/tmp/isolated-claude",
			),
		).toThrow("requires an OMP baseUrl or anthropicBaseUrl");
	});

	it("requires an explicit Responses gateway before reusing OMP for Codex", () => {
		expect(
			sharedCodexConfigFromOmp({
				baseUrl: " https://gateway.example/v1 ",
				apiKey: "gateway-key",
				model: " shared-model ",
			}),
		).toEqual({
			baseUrl: "https://gateway.example/v1",
			apiKey: "gateway-key",
			model: "shared-model",
		});
		expect(() => sharedCodexConfigFromOmp({ apiKey: "gateway-key" })).toThrow(
			"requires an OMP baseUrl and model",
		);
	});

	it("rejects unknown provider names before making calls", () => {
		expect(() =>
			parseLiveProviderSmokeArgs(["--provider", "unknown"]),
		).toThrow("Unknown provider 'unknown'");
	});
});
