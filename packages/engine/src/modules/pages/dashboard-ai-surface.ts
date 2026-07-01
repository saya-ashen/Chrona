import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@chrona/db";

import { db } from "@/lib/db";
import { dispatch, extractJSON, getAiClientForFeature } from "@/modules/ai";
import { validateDashboardSummarySpec } from "@chrona/ui-protocol";

export const DASHBOARD_BRIEF_SURFACE = "dashboard.brief" as const;

type DashboardAiBriefStatus = "ready" | "dirty" | "generating" | "failed" | "unconfigured";

type DashboardAiBriefState = {
  status: DashboardAiBriefStatus;
  spec: unknown | null;
  generatedAt: string | null;
  providerClientId: string | null;
  canGenerate: boolean;
  errorMessage: string | null;
  inputFingerprint: string;
};

type OutputRef = { id: string; title: string; type: string; taskId: string } | null;

type DashboardFingerprintInput = {
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
const DASHBOARD_BRIEF_PROMPT_VERSION = 3;

const dashboardAiBriefResultSchema = z.object({
  summaryText: z.string().trim().min(1).max(500).optional(),
  spec: z.unknown(),
});



function buildPromptInput(input: DashboardFingerprintInput) {
  return {
    role: "dashboard.brief",
    rules: [
      "Generate a compact json-render Chrona UI spec for the Dashboard AI summary card.",
      "Return JSON only with summaryText and spec.",
      "spec may use ONLY these component types: Stack, Card, Heading, Text, Alert, Badge, Separator, Table.",
      "All props must be literal JSON values. No actions, links, buttons, forms, inputs, repeat, state, dynamic expressions, or custom components.",
      "Keep output short: one heading, one concise summary, up to three highlights, and optional next-step text.",
      "Do not invent task IDs, counts, statuses, hrefs, approval actions, destructive actions, secrets, provider payloads, or raw task context.",
      "Do not include buttons, links, forms, inputs, tool payloads, tokens, or backend IDs.",
    ],
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
  return Boolean(lastAttemptAt && now - lastAttemptAt.getTime() < DASHBOARD_BRIEF_RETRY_COOLDOWN_MS);
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

export function fingerprintDashboardBriefInput(input: DashboardFingerprintInput): string {
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

export async function getDashboardAiBriefState(input: {
  workspaceId: string;
  fingerprintInput: DashboardFingerprintInput;
}): Promise<DashboardAiBriefState> {
  const inputFingerprint = fingerprintDashboardBriefInput(input.fingerprintInput);
  const provider = await getAiClientForFeature(DASHBOARD_BRIEF_SURFACE);
  const surface = await db.workspaceAiSurface.findUnique({
    where: { workspaceId_surface: { workspaceId: input.workspaceId, surface: DASHBOARD_BRIEF_SURFACE } },
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

  const status = surface.status === "ready" || surface.status === "generating" || surface.status === "failed"
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
  const inputFingerprint = fingerprintDashboardBriefInput(input.fingerprintInput);
  const provider = await getAiClientForFeature(DASHBOARD_BRIEF_SURFACE);
  const surface = await db.workspaceAiSurface.findUnique({
    where: { workspaceId_surface: { workspaceId: input.workspaceId, surface: DASHBOARD_BRIEF_SURFACE } },
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

  if (!input.force && surface?.status === "ready" && surface.inputFingerprint === inputFingerprint) {
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

  if (!input.force && surface?.lastAttemptAt && shouldDelayRetry(surface.lastAttemptAt)) {
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
    where: { workspaceId_surface: { workspaceId: input.workspaceId, surface: DASHBOARD_BRIEF_SURFACE } },
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
    const rawText = await dispatch(
      provider,
      DASHBOARD_BRIEF_SURFACE,
      buildPromptInput(input.fingerprintInput),
      `workspace:${input.workspaceId}:dashboard.brief:${inputFingerprint}`,
    );
    const parsed = dashboardAiBriefResultSchema.parse(extractJSON(rawText));
    const validation = validateDashboardSummarySpec(parsed.spec);
    if (!validation.ok) {
      throw new Error(`Generated dashboard brief spec invalid: ${validation.issues[0]?.message ?? "unknown issue"}`);
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
