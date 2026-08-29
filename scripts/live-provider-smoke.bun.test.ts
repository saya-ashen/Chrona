import { describe, expect, it } from "bun:test";

import { parseLiveProviderSmokeArgs } from "./live-provider-smoke";

describe("live provider smoke CLI", () => {
	it("selects every supported provider by default", () => {
		expect(parseLiveProviderSmokeArgs([]).providers).toEqual([
			"debug",
			"omp",
			"claude_code",
			"codex",
			"hermes",
		]);
	});

	it("accepts a bounded provider subset and explicit release options", () => {
		expect(
			parseLiveProviderSmokeArgs([
				"--provider",
				"omp,claude_code",
				"--allow-missing",
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
			reuseOmpForCodex: true,
			listOnly: false,
			chronaBaseUrl: "http://127.0.0.1:4101",
			reportPath: ".chrona/custom-provider-report.json",
		});
	});

	it("rejects unknown provider names before making calls", () => {
		expect(() =>
			parseLiveProviderSmokeArgs(["--provider", "unknown"]),
		).toThrow("Unknown provider 'unknown'");
	});
});
