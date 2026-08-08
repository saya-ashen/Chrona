import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@chrona/db";
import { isDashboardAiSummaryEnabled } from "@chrona/shared/runtime-config";

import { db } from "@chrona/db";
import {
	buildFeatureTerminalTool,
	buildProviderFeatureRequest,
	CHRONA_FEATURE_TERMINAL_TOOL_NAME,
	getAiClientForFeature,
	runProviderRequest,
} from "../ai";
import { validateDashboardSummarySpec } from "@chrona/ui-protocol";

export const DASHBOARD_BRIEF_SURFACE = "dashboard.brief" as const;

export type DashboardAiBriefStatus =
	| "ready"
	| "dirty"
	| "generating"
	| "failed"
	| "unconfigured"
	| "disabled";

export type DashboardAiBriefState = {
	status: DashboardAiBriefStatus;
	spec: unknown | null;
	generatedAt: string | null;
	providerClientId: string | null;
	canGenerate: boolean;
	errorMessage: string | null;
	inputFingerprint: string;
};

type OutputRef = {
	id: string;
	title: string;
	type: string;
	taskId: string;
} | null;

export type DashboardFingerprintInput = {
	needsAttention: Array<{
		taskId: string;
		title: string;
		status: string;
		kind: string;
		reason: string | null;
		latestOutput: OutputRef;
		updatedAt: string | null;
	}>;
	inProgress: Array<{
		taskId: string;
		title: string;
		status: string;
		latestRunStatus: string | null;
		stage: string | null;
		latestOutput: OutputRef;
		updatedAt: string | null;
	}>;
	upcomingToday: Array<{
		taskId: string;
		title: string;
		status: string;
		scheduledStartAt: string | null;
		dueAt: string | null;
		nextStep: string;
		updatedAt: string | null;
	}>;
	autoCompleted: Array<{
		taskId: string;
		title: string;
		completedAt: string | null;
		category: string;
		summary: string | null;
		output: OutputRef;
	}>;
	recentEvents: Array<{
		id: string;
		category: string;
		at: string;
		taskId: string;
		taskTitle: string;
		summary: string | null;
	}>;
	totalAutoCompleted: number;
};

const DASHBOARD_BRIEF_RETRY_COOLDOWN_MS = 30_000;
const DASHBOARD_BRIEF_PROMPT_VERSION = 4;

const dashboardAiBriefResultSchema = z
	.object({
		summaryText: z.string().trim().min(1).max(500).optional(),
		spec: z.custom<unknown>((value) => value !== undefined),
	})
	.strict();

const dashboardBriefStructuredOutputSchema = {
	name: "dashboard_brief_result",
	description: "A bounded Dashboard brief with a validated UI specification.",
	schema: {
		type: "object" as const,
		properties: {
			summaryText: { type: "string" as const, maxLength: 500 },
			spec: { type: "object" as const },
		},
		required: ["spec"],
		additionalProperties: false,
	},
};

export function parseDashboardBriefPayload(input: unknown) {
	const parsed = dashboardAiBriefResultSchema.safeParse(input);
	if (!parsed.success) {
		throw new Error(
			"Generated dashboard brief response invalid: expected JSON object with spec",
		);
	}
	return parsed.data;
}

export function buildDashboardBriefPromptInput(
	input: DashboardFingerprintInput,
) {
	return {
		role: "dashboard.brief",
		rules: [
			"Generate a compact json-render Chrona UI spec for the Dashboard AI summary card.",
			"Treat this as an executive operating brief for Chrona Dashboard, not a task list or duplicate of the side modules.",
			"Use an attention-first structure: one heading, one situation summary, up to three signal highlights, and one informational recommended next step.",
			"If needsAttention has items, lead with what needs user action and why; prioritize approval, input, blocked, failed, then schedule risk.",
			"If needsAttention is empty, state the all-clear briefly; do not repeat large 'nothing needs you' copy or manufacture urgency.",
			"Use running work, recent completions, and recent events only to explain momentum, value delivered, or meaningful change patterns.",
			"Do not list every task. Summarize implications and only mention task titles when they clarify a user decision.",
			"Recommended next step must be plain informational text, not an action control or command.",
			"Return the final brief as the structured output { summaryText, spec }.",
			"Do not rely on assistant prose as the final answer.",
			"spec may use ONLY these component types: Stack, Card, Heading, Text, Alert, Badge, Separator, Table.",
			"All props must be literal JSON values. No actions, links, buttons, forms, inputs, repeat, state, dynamic expressions, or custom components.",
			"Do not invent task IDs, counts, statuses, hrefs, approval actions, destructive actions, secrets, provider payloads, or raw task context.",
			"Do not include buttons, links, forms, inputs, tool payloads, tokens, or backend IDs.",
		],
		presentationContract: {
			purpose: "Operational brief above dashboard modules",
			sections: ["heading", "situation", "signals", "recommendedNextStep"],
			attentionPolicy: "needsAttention first; quiet all-clear when empty",
			duplicationPolicy:
				"summarize patterns; do not recreate Focus queue, Running now, Recent completions, or Recent activity lists",
		},
		facts: {
			needsAttention: input.needsAttention,
			inProgress: input.inProgress,
			autoCompleted: input.autoCompleted.slice(0, 20),
			recentEvents: input.recentEvents.slice(0, 30),
			totalAutoCompleted: input.totalAutoCompleted,
		},
	};
}

function shouldDelayRetry(lastAttemptAt: Date | null, now = Date.now()) {
	return Boolean(
		lastAttemptAt &&
			now - lastAttemptAt.getTime() < DASHBOARD_BRIEF_RETRY_COOLDOWN_MS,
	);
}

function errorMessage(cause: unknown) {
	return cause instanceof Error ? cause.message : String(cause);
}

function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
		.join(",")}}`;
}

export function fingerprintDashboardBriefInput(
	input: DashboardFingerprintInput,
): string {
	const payload = {
		promptVersion: DASHBOARD_BRIEF_PROMPT_VERSION,
		needsAttention: input.needsAttention.map((item) => ({
			taskId: item.taskId,
			title: item.title,
			status: item.status,
			kind: item.kind,
			reason: item.reason,
			latestOutput: item.latestOutput,
			updatedAt: item.updatedAt,
		})),
		inProgress: input.inProgress.map((item) => ({
			taskId: item.taskId,
			title: item.title,
			status: item.status,
			latestRunStatus: item.latestRunStatus,
			stage: item.stage,
			latestOutput: item.latestOutput,
			updatedAt: item.updatedAt,
		})),
		autoCompleted: input.autoCompleted.slice(0, 20).map((item) => ({
			taskId: item.taskId,
			title: item.title,
			completedAt: item.completedAt,
			category: item.category,
			summary: item.summary,
			output: item.output,
		})),
		recentEvents: input.recentEvents.slice(0, 30),
		totalAutoCompleted: input.totalAutoCompleted,
	};

	return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function toDashboardAiBriefState(input: {
	status: DashboardAiBriefStatus;
	spec: unknown | null;
	generatedAt: Date | null;
	providerClientId: string | null;
	canGenerate: boolean;
	errorMessage: string | null;
	inputFingerprint: string;
}): DashboardAiBriefState {
	return {
		status: input.status,
		spec: input.spec,
		generatedAt: input.generatedAt?.toISOString() ?? null,
		providerClientId: input.providerClientId,
		canGenerate: input.canGenerate,
		errorMessage: input.errorMessage,
		inputFingerprint: input.inputFingerprint,
	};
}

export function dashboardAiBriefDisabledState(
	inputFingerprint = "disabled",
): DashboardAiBriefState {
	return toDashboardAiBriefState({
		status: "disabled",
		spec: null,
		generatedAt: null,
		providerClientId: null,
		canGenerate: false,
		errorMessage: null,
		inputFingerprint,
	});
}

export async function getDashboardAiBriefState(input: {
	workspaceId: string;
	fingerprintInput: DashboardFingerprintInput;
}): Promise<DashboardAiBriefState> {
	const inputFingerprint = fingerprintDashboardBriefInput(
		input.fingerprintInput,
	);
	const provider = await getAiClientForFeature(DASHBOARD_BRIEF_SURFACE);
	const surface = await db.workspaceAiSurface.findUnique({
		where: {
			workspaceId_surface: {
				workspaceId: input.workspaceId,
				surface: DASHBOARD_BRIEF_SURFACE,
			},
		},
	});

	if (!provider) {
		return toDashboardAiBriefState({
			status: "unconfigured",
			spec: surface?.generatedSpec ?? null,
			generatedAt: surface?.generatedAt ?? null,
			providerClientId: surface?.providerClientId ?? null,
			canGenerate: false,
			errorMessage: null,
			inputFingerprint,
		});
	}

	if (!surface) {
		const created = await db.workspaceAiSurface.create({
			data: {
				workspaceId: input.workspaceId,
				surface: DASHBOARD_BRIEF_SURFACE,
				status: "dirty",
				inputFingerprint,
				dirtyAt: new Date(),
			},
		});
		return toDashboardAiBriefState({
			status: "dirty",
			spec: null,
			generatedAt: null,
			providerClientId: provider.record.id,
			canGenerate: true,
			errorMessage: created.errorMessage,
			inputFingerprint,
		});
	}

	if (surface.inputFingerprint !== inputFingerprint) {
		const updated = await db.workspaceAiSurface.update({
			where: { id: surface.id },
			data: {
				status: "dirty",
				inputFingerprint,
				dirtyAt: new Date(),
				lastAttemptAt: null,
				errorMessage: null,
			},
		});
		return toDashboardAiBriefState({
			status: "dirty",
			spec: updated.generatedSpec,
			generatedAt: updated.generatedAt,
			providerClientId: provider.record.id,
			canGenerate: true,
			errorMessage: null,
			inputFingerprint,
		});
	}

	const status =
		surface.status === "ready" ||
		surface.status === "generating" ||
		surface.status === "failed"
			? surface.status
			: "dirty";

	return toDashboardAiBriefState({
		status,
		spec: surface.generatedSpec,
		generatedAt: surface.generatedAt,
		providerClientId: surface.providerClientId ?? provider.record.id,
		canGenerate: status !== "generating",
		errorMessage: surface.errorMessage,
		inputFingerprint,
	});
}

export async function generateDashboardBrief(input: {
	workspaceId: string;
	fingerprintInput: DashboardFingerprintInput;
	force?: boolean;
}): Promise<DashboardAiBriefState> {
	const inputFingerprint = fingerprintDashboardBriefInput(
		input.fingerprintInput,
	);
	if (!isDashboardAiSummaryEnabled())
		return dashboardAiBriefDisabledState(inputFingerprint);
	const provider = await getAiClientForFeature(DASHBOARD_BRIEF_SURFACE);
	const surface = await db.workspaceAiSurface.findUnique({
		where: {
			workspaceId_surface: {
				workspaceId: input.workspaceId,
				surface: DASHBOARD_BRIEF_SURFACE,
			},
		},
	});

	if (!provider) {
		return toDashboardAiBriefState({
			status: "unconfigured",
			spec: surface?.generatedSpec ?? null,
			generatedAt: surface?.generatedAt ?? null,
			providerClientId: surface?.providerClientId ?? null,
			canGenerate: false,
			errorMessage: null,
			inputFingerprint,
		});
	}

	if (
		!input.force &&
		surface?.status === "ready" &&
		surface.inputFingerprint === inputFingerprint
	) {
		return toDashboardAiBriefState({
			status: "ready",
			spec: surface.generatedSpec,
			generatedAt: surface.generatedAt,
			providerClientId: surface.providerClientId ?? provider.record.id,
			canGenerate: true,
			errorMessage: surface.errorMessage,
			inputFingerprint,
		});
	}

	if (
		!input.force &&
		surface?.lastAttemptAt &&
		shouldDelayRetry(surface.lastAttemptAt)
	) {
		return toDashboardAiBriefState({
			status: surface.status as DashboardAiBriefStatus,
			spec: surface.generatedSpec,
			generatedAt: surface.generatedAt,
			providerClientId: surface.providerClientId ?? provider.record.id,
			canGenerate: false,
			errorMessage: surface.errorMessage,
			inputFingerprint,
		});
	}

	const generating = await db.workspaceAiSurface.upsert({
		where: {
			workspaceId_surface: {
				workspaceId: input.workspaceId,
				surface: DASHBOARD_BRIEF_SURFACE,
			},
		},
		create: {
			workspaceId: input.workspaceId,
			surface: DASHBOARD_BRIEF_SURFACE,
			status: "generating",
			inputFingerprint,
			providerClientId: provider.record.id,
			lastAttemptAt: new Date(),
		},
		update: {
			status: "generating",
			inputFingerprint,
			providerClientId: provider.record.id,
			lastAttemptAt: new Date(),
			errorMessage: null,
		},
	});

	try {
		const scope = `workspace:${input.workspaceId}:dashboard.brief:${inputFingerprint}`;
		const providerClient = provider.providerClient;
		if (!providerClient)
			throw new Error("Dashboard brief requires a terminal-tool provider");
		const parsed = parseDashboardBriefPayload(
			(
				await runProviderRequest(
					providerClient,
					buildProviderFeatureRequest({
						sessionKey: scope,
						instructions: "Feature: dashboard.brief",
						input: buildDashboardBriefPromptInput(input.fingerprintInput),
						stream: false,
						structuredOutputSchema: dashboardBriefStructuredOutputSchema,
						tools: [
							buildFeatureTerminalTool(dashboardBriefStructuredOutputSchema),
						],
						terminalToolName: CHRONA_FEATURE_TERMINAL_TOOL_NAME,
						toolPolicy: "terminal_only",
					}),
				)
			).structuredPayload,
		);
		const validation = validateDashboardSummarySpec(parsed.spec);
		if (!validation.ok) {
			throw new Error(
				`Generated dashboard brief spec invalid: ${validation.issues[0]?.message ?? "unknown issue"}`,
			);
		}

		const saved = await db.workspaceAiSurface.update({
			where: { id: generating.id },
			data: {
				status: "ready",
				generatedSpec: validation.spec as Prisma.InputJsonValue,
				summaryText: parsed.summaryText ?? null,
				providerClientId: provider.record.id,
				generatedAt: new Date(),
				inputFingerprint,
				errorMessage: null,
			},
		});

		return toDashboardAiBriefState({
			status: "ready",
			spec: saved.generatedSpec,
			generatedAt: saved.generatedAt,
			providerClientId: saved.providerClientId,
			canGenerate: true,
			errorMessage: null,
			inputFingerprint,
		});
	} catch (cause) {
		const failed = await db.workspaceAiSurface.update({
			where: { id: generating.id },
			data: {
				status: "failed",
				errorMessage: errorMessage(cause),
			},
		});
		return toDashboardAiBriefState({
			status: "failed",
			spec: failed.generatedSpec,
			generatedAt: failed.generatedAt,
			providerClientId: failed.providerClientId ?? provider.record.id,
			canGenerate: false,
			errorMessage: failed.errorMessage,
			inputFingerprint,
		});
	}
}
