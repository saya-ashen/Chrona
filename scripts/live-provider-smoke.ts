#!/usr/bin/env bun
/* eslint-disable complexity, max-lines, max-lines-per-function -- Live smoke explicitly enumerates each provider's configuration contract. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
	providerCapabilityMatrix,
	type AiClientType,
} from "@chrona/contracts";
import { db } from "@chrona/db";
import { ClaudeCodeProviderClient, type ClaudeCodeProviderConfig } from "@chrona/claude-code";
import { CodexProviderClient, type CodexProviderConfig } from "@chrona/codex";
import { HermesProviderClient, type HermesProviderConfig } from "@chrona/hermes";
import { OmpProviderClient, type OmpProviderConfig } from "@chrona/omp";
import {
	LIVE_PROVIDER_SMOKE_MARKER,
	runLiveProviderSmoke,
	type AgentProviderClient,
	type LiveProviderSmokeResult,
} from "@chrona/providers-foundation";
import { ChronaDebugProviderClient } from "@chrona/providers-debug";

export type LiveProviderType =
	(typeof providerCapabilityMatrix)[number]["provider"];

type StoredClient = {
	name: string;
	type: string;
	config: unknown;
	isDefault: boolean;
};

type ProviderTarget = {
	provider: LiveProviderType;
	label: string;
	source: string;
	client?: AgentProviderClient;
	expectedOutputContains?: string;
	secrets: string[];
	skipReason?: string;
};

type ProviderReportEntry = {
	provider: LiveProviderType;
	label: string;
	source: string;
	status: "passed" | "failed" | "skipped";
	durationMs: number;
	health?: LiveProviderSmokeResult["health"];
	capabilities?: LiveProviderSmokeResult["capabilities"];
	run?: LiveProviderSmokeResult["run"];
	error?: string;
};

export type LiveProviderSmokeCliOptions = {
	providers: LiveProviderType[];
	timeoutMs: number;
	allowMissing: boolean;
	reuseOmpForCodex: boolean;
	listOnly: boolean;
	chronaBaseUrl: string;
	reportPath: string;
};

const PROVIDER_ORDER: LiveProviderType[] = [
	"debug",
	"omp",
	"claude_code",
	"codex",
	"hermes",
];
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_REPORT = ".chrona/provider-smoke/latest.json";

function providerType(value: string): LiveProviderType {
	const found = providerCapabilityMatrix.find((entry) => entry.provider === value);
	if (!found) {
		throw new Error(
			`Unknown provider '${value}'. Expected one of ${PROVIDER_ORDER.join(", ")}.`,
		);
	}
	return found.provider;
}

function takeValue(argv: string[], index: number, flag: string): string {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`);
	}
	return value;
}

export function parseLiveProviderSmokeArgs(
	argv: string[],
): LiveProviderSmokeCliOptions {
	const providers: LiveProviderType[] = [];
	let timeoutMs = DEFAULT_TIMEOUT_MS;
	let allowMissing = false;
	let reuseOmpForCodex = false;
	let listOnly = false;
	let chronaBaseUrl =
		process.env.CHRONA_MCP_BASE_URL?.trim() || "http://127.0.0.1:3101";
	let reportPath = DEFAULT_REPORT;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]!;
		if (arg === "--provider") {
			providers.push(
				...takeValue(argv, index, arg)
					.split(",")
					.map((value) => providerType(value.trim())),
			);
			index += 1;
			continue;
		}
		if (arg.startsWith("--provider=")) {
			providers.push(
				...arg
					.slice("--provider=".length)
					.split(",")
					.map((value) => providerType(value.trim())),
			);
			continue;
		}
		if (arg === "--timeout-ms") {
			timeoutMs = Number(takeValue(argv, index, arg));
			index += 1;
			continue;
		}
		if (arg === "--chrona-base-url") {
			chronaBaseUrl = takeValue(argv, index, arg).replace(/\/$/, "");
			index += 1;
			continue;
		}
		if (arg === "--report") {
			reportPath = takeValue(argv, index, arg);
			index += 1;
			continue;
		}
		if (arg === "--allow-missing") {
			allowMissing = true;
			continue;
		}
		if (arg === "--reuse-omp-for-codex") {
			reuseOmpForCodex = true;
			continue;
		}
		if (arg === "--list") {
			listOnly = true;
			continue;
		}
		if (arg === "--all") continue;
		if (arg === "--help" || arg === "-h") {
			console.log(usage());
			process.exit(0);
		}
		throw new Error(`Unknown option '${arg}'`);
	}

	if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) {
		throw new Error("--timeout-ms must be a number greater than or equal to 1000");
	}

	return {
		providers:
			providers.length > 0
				? PROVIDER_ORDER.filter((provider) => providers.includes(provider))
				: [...PROVIDER_ORDER],
		timeoutMs,
		allowMissing,
		reuseOmpForCodex,
		listOnly,
		chronaBaseUrl,
		reportPath,
	};
}

function usage(): string {
	return [
		"Live provider smoke (real provider calls; may consume quota)",
		"",
		"Usage:",
		"  bun run test:providers:live -- --all",
		"  bun run test:providers:live -- --provider omp,claude_code",
		"",
		"Options:",
		"  --provider <types>       Comma-separated provider types.",
		"  --all                    Test every provider in the capability matrix (default).",
		"  --allow-missing          Do not fail when a provider has no usable configuration.",
		"  --reuse-omp-for-codex    Explicitly reuse a configured OMP gateway credential for Codex smoke.",
		"  --chrona-base-url <url>  Chrona API base used by ACP/Codex health. Default http://127.0.0.1:3101.",
		"  --timeout-ms <number>    Per-stage timeout. Default 120000.",
		"  --report <path>          Redacted JSON report. Default .chrona/provider-smoke/latest.json.",
		"  --list                   Show selected provider/config sources without making calls.",
	].join("\n");
}

function asConfig(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function configuredSecretValues(config: Record<string, unknown>): string[] {
	const values: string[] = [];
	for (const [key, value] of Object.entries(config)) {
		if (typeof value === "string" && /key|token|secret|password|auth/i.test(key)) {
			if (value.length >= 6) values.push(value);
		}
		if (key === "env" && value && typeof value === "object" && !Array.isArray(value)) {
			for (const [envKey, envValue] of Object.entries(value)) {
				if (
					typeof envValue === "string" &&
					/key|token|secret|password|auth/i.test(envKey) &&
					envValue.length >= 6
				) {
					values.push(envValue);
				}
			}
		}
	}
	return values;
}

function redact(value: string | undefined, secrets: string[]): string | undefined {
	if (!value) return value;
	let safe = value;
	for (const secret of secrets) safe = safe.replaceAll(secret, "[REDACTED]");
	return safe
		.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

function storedClientFor(
	records: StoredClient[],
	type: LiveProviderType,
): StoredClient | undefined {
	return records
		.filter((record) => record.type === type)
		.sort((left, right) => Number(right.isDefault) - Number(left.isDefault))[0];
}

function providerLabel(provider: LiveProviderType): string {
	return (
		providerCapabilityMatrix.find((entry) => entry.provider === provider)?.label ??
		provider
	);
}

function targetFromStored(input: {
	provider: Exclude<LiveProviderType, "debug">;
	record: StoredClient;
	cwd: string;
	timeoutMs: number;
	chronaBaseUrl: string;
}): ProviderTarget {
	const config = asConfig(input.record.config);
	const common = { ...config, cwd: input.cwd, timeoutMs: input.timeoutMs };
	let client: AgentProviderClient;
	if (input.provider === "omp") {
		client = new OmpProviderClient({ config: common as OmpProviderConfig });
	} else if (input.provider === "claude_code") {
		client = new ClaudeCodeProviderClient({
			config: {
				...common,
				mcpBaseUrl: input.chronaBaseUrl,
				mcpRunToken:
					typeof config.mcpRunToken === "string" ? config.mcpRunToken : "",
			} as ClaudeCodeProviderConfig,
		});
	} else if (input.provider === "codex") {
		client = new CodexProviderClient({
			config: {
				...common,
				mcpBaseUrl: input.chronaBaseUrl,
				initialAgentMode: "read-only",
			} as CodexProviderConfig,
		});
	} else {
		client = new HermesProviderClient(common as HermesProviderConfig);
	}
	return {
		provider: input.provider,
		label: providerLabel(input.provider),
		source: `database client: ${input.record.name}`,
		client,
		secrets: configuredSecretValues(config),
	};
}

function localTarget(input: {
	provider: LiveProviderType;
	cwd: string;
	timeoutMs: number;
	chronaBaseUrl: string;
}): ProviderTarget {
	const label = providerLabel(input.provider);
	if (input.provider === "debug") {
		return {
			provider: input.provider,
			label,
			source: "built-in deterministic provider",
			client: new ChronaDebugProviderClient(),
			expectedOutputContains: "completed the session",
			secrets: [],
		};
	}
	if (input.provider === "claude_code") {
		const apiKey = process.env.ANTHROPIC_API_KEY;
		const config: ClaudeCodeProviderConfig = {
			cwd: input.cwd,
			timeoutMs: input.timeoutMs,
			mcpBaseUrl: input.chronaBaseUrl,
			mcpRunToken:
				process.env.CHRONA_API_KEY ??
				process.env.CHRONA_MCP_BEARER_TOKEN ??
				"",
			...(process.env.CHRONA_LIVE_CLAUDE_MODEL
				? { model: process.env.CHRONA_LIVE_CLAUDE_MODEL }
				: {}),
			...(apiKey ? { apiKey } : {}),
		};
		return {
			provider: input.provider,
			label,
			source: "local Claude Code authentication",
			client: new ClaudeCodeProviderClient({ config }),
			secrets: [apiKey, config.mcpRunToken].filter(
				(value): value is string => Boolean(value),
			),
		};
	}
	if (input.provider === "codex") {
		const apiKey = process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY;
		const config: CodexProviderConfig = {
			cwd: input.cwd,
			timeoutMs: input.timeoutMs,
			mcpBaseUrl: input.chronaBaseUrl,
			mcpRunToken:
				process.env.CHRONA_API_KEY ?? process.env.CHRONA_MCP_BEARER_TOKEN,
			initialAgentMode: "read-only",
			...(process.env.CHRONA_LIVE_CODEX_MODEL
				? { model: process.env.CHRONA_LIVE_CODEX_MODEL }
				: {}),
			...(apiKey ? { apiKey } : {}),
		};
		return {
			provider: input.provider,
			label,
			source: "local Codex authentication",
			client: new CodexProviderClient({ config }),
			secrets: [apiKey, config.mcpRunToken].filter(
				(value): value is string => Boolean(value),
			),
		};
	}
	if (input.provider === "omp") {
		const apiKey = process.env.CHRONA_OMP_API_KEY;
		const config: OmpProviderConfig = {
			cwd: input.cwd,
			timeoutMs: input.timeoutMs,
			...(process.env.CHRONA_LIVE_OMP_MODEL
				? { model: process.env.CHRONA_LIVE_OMP_MODEL }
				: {}),
			...(process.env.CHRONA_LIVE_OMP_PROVIDER
				? { provider: process.env.CHRONA_LIVE_OMP_PROVIDER }
				: {}),
			...(apiKey ? { apiKey } : {}),
		};
		return {
			provider: input.provider,
			label,
			source: "local Oh My Pi authentication",
			client: new OmpProviderClient({ config }),
			secrets: apiKey ? [apiKey] : [],
		};
	}

	const baseUrl =
		process.env.CHRONA_HERMES_BASE_URL ?? process.env.HERMES_BASE_URL;
	const apiKey =
		process.env.CHRONA_HERMES_API_KEY ?? process.env.HERMES_API_KEY;
	if (!baseUrl) {
		return {
			provider: input.provider,
			label,
			source: "not configured",
			secrets: [],
			skipReason:
				"No enabled Hermes client or CHRONA_HERMES_BASE_URL/HERMES_BASE_URL",
		};
	}
	return {
		provider: input.provider,
		label,
		source: "Hermes environment configuration",
		client: new HermesProviderClient({
			baseUrl,
			apiKey,
			timeoutMs: input.timeoutMs,
		}),
		secrets: apiKey ? [apiKey] : [],
	};
}

async function loadTargets(
	options: LiveProviderSmokeCliOptions,
	tempRoot: string,
): Promise<ProviderTarget[]> {
	const recordTypes = [
		...new Set([
			...options.providers,
			...(options.reuseOmpForCodex ? (["omp"] as const) : []),
		]),
	];
	const records = (await db.aiClient.findMany({
		where: { enabled: true, type: { in: recordTypes as AiClientType[] } },
		orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
		select: { name: true, type: true, config: true, isDefault: true },
	})) as StoredClient[];

	return options.providers.map((provider) => {
		const cwd = join(tempRoot, provider);
		mkdirSync(cwd, { recursive: true });
		const record = storedClientFor(records, provider);
		if (record && provider !== "debug") {
			return targetFromStored({
				provider,
				record,
				cwd,
				timeoutMs: options.timeoutMs,
				chronaBaseUrl: options.chronaBaseUrl,
			});
		}
		if (provider === "codex" && options.reuseOmpForCodex) {
			const ompRecord = storedClientFor(records, "omp");
			if (ompRecord) {
				const omp = asConfig(ompRecord.config);
				const target = targetFromStored({
					provider,
					record: {
						...ompRecord,
						config: {
							baseUrl: omp.baseUrl,
							apiKey: omp.apiKey,
							model: omp.model,
						},
					},
					cwd,
					timeoutMs: options.timeoutMs,
					chronaBaseUrl: options.chronaBaseUrl,
				});
				return {
					...target,
					source: `OMP gateway reused for Codex smoke: ${ompRecord.name}`,
				};
			}
		}
		return localTarget({
			provider,
			cwd,
			timeoutMs: options.timeoutMs,
			chronaBaseUrl: options.chronaBaseUrl,
		});
	});
}

function printTargets(targets: ProviderTarget[]) {
	for (const target of targets) {
		const state = target.skipReason ? "MISSING" : "READY";
		console.log(`${state.padEnd(7)} ${target.provider.padEnd(12)} ${target.source}`);
	}
}

function sanitizeResult(
	target: ProviderTarget,
	result: LiveProviderSmokeResult,
): ProviderReportEntry {
	return {
		provider: target.provider,
		label: target.label,
		source: target.source,
		status: result.status,
		durationMs: result.durationMs,
		health: {
			...result.health,
			reason: redact(result.health.reason, target.secrets),
		},
		capabilities: result.capabilities,
		run: result.run,
		error: redact(result.error, target.secrets),
	};
}

function writeReport(path: string, report: unknown) {
	const absolute = resolve(path);
	mkdirSync(dirname(absolute), { recursive: true });
	writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	return absolute;
}

export async function runLiveProviderSmokeCli(
	options: LiveProviderSmokeCliOptions,
): Promise<number> {
	const startedAt = new Date().toISOString();
	const tempRoot = mkdtempSync(join(tmpdir(), "chrona-provider-smoke-"));
	try {
		const targets = await loadTargets(options, tempRoot);
		if (options.listOnly) {
			printTargets(targets);
			return 0;
		}

		console.log("Real provider calls enabled. Prompts contain only a fixed smoke marker.");
		const results: ProviderReportEntry[] = [];
		for (const target of targets) {
			if (!target.client || target.skipReason) {
				results.push({
					provider: target.provider,
					label: target.label,
					source: target.source,
					status: "skipped",
					durationMs: 0,
					error: target.skipReason,
				});
				console.log(`SKIP ${target.provider}: ${target.skipReason}`);
				continue;
			}

			process.stdout.write(`RUN  ${target.provider} (${target.source}) ... `);
			const result = await runLiveProviderSmoke(target.client, {
				timeoutMs: options.timeoutMs,
				expectedOutputContains:
					target.expectedOutputContains ?? LIVE_PROVIDER_SMOKE_MARKER,
			});
			const sanitized = sanitizeResult(target, result);
			results.push(sanitized);
			console.log(
				`${sanitized.status.toUpperCase()} ${Math.round(sanitized.durationMs / 1000)}s${sanitized.error ? ` — ${sanitized.error}` : ""}`,
			);
		}

		const report = {
			schemaVersion: 1,
			startedAt,
			finishedAt: new Date().toISOString(),
			chronaBaseUrl: options.chronaBaseUrl,
			results,
			summary: {
				passed: results.filter((result) => result.status === "passed").length,
				failed: results.filter((result) => result.status === "failed").length,
				skipped: results.filter((result) => result.status === "skipped").length,
			},
		};
		const reportPath = writeReport(options.reportPath, report);
		console.log(`Report: ${reportPath}`);

		const failed = results.some((result) => result.status === "failed");
		const missing = results.some((result) => result.status === "skipped");
		return failed || (missing && !options.allowMissing) ? 1 : 0;
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
		await db.$disconnect();
	}
}

if (import.meta.main) {
	try {
		const options = parseLiveProviderSmokeArgs(Bun.argv.slice(2));
		process.exitCode = await runLiveProviderSmokeCli(options);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
