import { beforeEach, describe, expect, it } from "bun:test";

import { db } from "@/lib/db";
import { aiClientRegistry } from "@/modules/ai";
import { buildDashboardBriefPromptInput, dashboardBriefFromTool, fingerprintDashboardBriefInput, generateDashboardBrief, parseDashboardBriefPayload, type DashboardFingerprintInput } from "./dashboard-ai-surface";
import { getDashboard } from "./get-dashboard";

async function seedDefaultClient() {
  const client = await db.aiClient.create({
    data: {
      name: "Debug provider",
      type: "debug",
      config: { profile: "deterministic" },
      isDefault: true,
      enabled: true,
    },
  });
  await aiClientRegistry.refresh();
  return client;
}

async function resetDb() {
  await db.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  try {
    await db.toolInvocation.deleteMany();
    await db.rawEventLog.deleteMany();
    await db.aiFeatureBinding.deleteMany();
    await db.workspaceAiSurface.deleteMany();
    await db.aiClient.deleteMany();
    await db.taskProjection.deleteMany();
    await db.task.deleteMany();
    await db.workspace.deleteMany();
  } finally {
    await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  }
}

async function seedWorkspace(name: string) {
  const workspace = await db.workspace.create({
    data: { name, status: "Active", defaultRuntime: "hermes" },
  });
  return { workspaceId: workspace.id };
}

async function seedTask(workspaceId: string, input: { title: string; status: "Blocked" }) {
  const task = await db.task.create({
    data: {
      workspaceId,
      title: input.title,
      status: input.status,
      priority: "High",
      executionRuntime: "hermes",
      executionConfig: {},
    },
  });
  return { taskId: task.id };
}

const dashboardBriefSpec = {
  root: "root",
  elements: {
    root: { type: "Text", props: { text: "One task needs review." }, children: [] },
  },
};
function baseFingerprintInput(): DashboardFingerprintInput {
  return {
    needsAttention: [],
    inProgress: [],
    upcomingToday: [],
    autoCompleted: [],
    recentEvents: [],
    totalAutoCompleted: 0,
  };
}

function attentionItem(overrides: Partial<DashboardFingerprintInput["needsAttention"][number]> = {}): DashboardFingerprintInput["needsAttention"][number] {
  return {
    taskId: "attention-1",
    title: "Approve plan",
    status: "WaitingForApproval",
    kind: "approval",
    reason: "Plan needs approval",
    latestOutput: null,
    updatedAt: "2026-07-03T00:00:00.000Z",
    ...overrides,
  };
}

function inProgressItem(overrides: Partial<DashboardFingerprintInput["inProgress"][number]> = {}): DashboardFingerprintInput["inProgress"][number] {
  return {
    taskId: "running-1",
    title: "Run task",
    status: "Running",
    latestRunStatus: "Running",
    stage: "Execute",
    latestOutput: null,
    updatedAt: "2026-07-03T00:01:00.000Z",
    ...overrides,
  };
}

function upcomingItem(overrides: Partial<DashboardFingerprintInput["upcomingToday"][number]> = {}): DashboardFingerprintInput["upcomingToday"][number] {
  return {
    taskId: "upcoming-1",
    title: "Later task",
    status: "Ready",
    scheduledStartAt: "2026-07-03T09:00:00.000Z",
    dueAt: null,
    nextStep: "start_execution",
    updatedAt: "2026-07-03T00:02:00.000Z",
    ...overrides,
  };
}

function completedItem(index: number, overrides: Partial<DashboardFingerprintInput["autoCompleted"][number]> = {}): DashboardFingerprintInput["autoCompleted"][number] {
  return {
    taskId: `done-${index}`,
    title: `Done ${index}`,
    completedAt: "2026-07-03T00:03:00.000Z",
    category: "general",
    summary: null,
    output: null,
    ...overrides,
  };
}

function recentEvent(index: number, overrides: Partial<DashboardFingerprintInput["recentEvents"][number]> = {}): DashboardFingerprintInput["recentEvents"][number] {
  return {
    id: `event-${index}`,
    category: "completed",
    at: "2026-07-03T00:04:00.000Z",
    taskId: `event-task-${index}`,
    taskTitle: `Event task ${index}`,
    summary: null,
    ...overrides,
  };
}

function fingerprint(input: DashboardFingerprintInput = baseFingerprintInput()) {
  return fingerprintDashboardBriefInput(input);
}

beforeEach(async () => {
  await resetDb();
});

describe("dashboard AI surface state", () => {
  it("returns unconfigured when no provider exists", async () => {
    const { workspaceId } = await seedWorkspace("No provider workspace");

    const dashboard = await getDashboard(workspaceId);

    expect(dashboard.aiBrief.status).toBe("unconfigured");
    expect(dashboard.aiBrief.canGenerate).toBe(false);
    expect(dashboard.aiBrief.spec).toBeNull();
  });

  it("creates a dirty dashboard brief surface when provider exists", async () => {
    const { workspaceId } = await seedWorkspace("Dirty workspace");
    const client = await seedDefaultClient();

    const dashboard = await getDashboard(workspaceId);
    const surface = await db.workspaceAiSurface.findUnique({
      where: { workspaceId_surface: { workspaceId, surface: "dashboard.brief" } },
    });

    expect(dashboard.aiBrief.status).toBe("dirty");
    expect(dashboard.aiBrief.canGenerate).toBe(true);
    expect(dashboard.aiBrief.providerClientId).toBe(client.id);
    expect(surface?.inputFingerprint).toBe(dashboard.aiBrief.inputFingerprint);
  });

  it("marks stale failed brief dirty and clears retry cooldown when dashboard facts change", async () => {
    const { workspaceId } = await seedWorkspace("Stale workspace");
    await seedDefaultClient();
    const initial = await getDashboard(workspaceId);
    await db.workspaceAiSurface.update({
      where: { workspaceId_surface: { workspaceId, surface: "dashboard.brief" } },
      data: {
        status: "failed",
        generatedSpec: { root: "root", elements: { root: { type: "Stack", props: {} } } },
        generatedAt: new Date(),
        lastAttemptAt: new Date(),
        errorMessage: "old schema failure",
      },
    });

    const { taskId } = await seedTask(workspaceId, { title: "Blocked task", status: "Blocked" });
    await db.taskProjection.create({
      data: {
        workspaceId,
        taskId,
        persistedStatus: "Blocked",
        displayState: "Attention Needed",
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const changed = await getDashboard(workspaceId);

    expect(changed.aiBrief.status).toBe("dirty");
    expect(changed.aiBrief.canGenerate).toBe(true);
    expect(changed.aiBrief.errorMessage).toBeNull();
    expect(changed.aiBrief.spec).not.toBeNull();
    expect(changed.aiBrief.inputFingerprint).not.toBe(initial.aiBrief.inputFingerprint);

    const surface = await db.workspaceAiSurface.findUniqueOrThrow({
      where: { workspaceId_surface: { workspaceId, surface: "dashboard.brief" } },
    });
    expect(surface.lastAttemptAt).toBeNull();
  });

  it("keeps a ready brief ready when dashboard fingerprint is unchanged", async () => {
    const { workspaceId } = await seedWorkspace("Ready workspace");
    await seedDefaultClient();
    const dashboard = await getDashboard(workspaceId);
    const generatedAt = new Date("2026-07-03T00:00:00.000Z");
    await db.workspaceAiSurface.update({
      where: { workspaceId_surface: { workspaceId, surface: "dashboard.brief" } },
      data: {
        status: "ready",
        generatedSpec: dashboardBriefSpec,
        generatedAt,
        providerClientId: dashboard.aiBrief.providerClientId,
      },
    });

    const current = await getDashboard(workspaceId);

    expect(current.aiBrief.status).toBe("ready");
    expect(current.aiBrief.canGenerate).toBe(true);
    expect(current.aiBrief.spec).toEqual(dashboardBriefSpec);
    expect(current.aiBrief.generatedAt).toBe(generatedAt.toISOString());
    expect(current.aiBrief.inputFingerprint).toBe(dashboard.aiBrief.inputFingerprint);
  });

  it("skips generation for ready same-fingerprint briefs unless forced", async () => {
    const { workspaceId } = await seedWorkspace("Skip generation workspace");
    const client = await seedDefaultClient();
    const input = baseFingerprintInput();
    const inputFingerprint = fingerprint(input);
    const generatedAt = new Date("2026-07-03T00:00:00.000Z");
    await db.workspaceAiSurface.create({
      data: {
        workspaceId,
        surface: "dashboard.brief",
        status: "ready",
        inputFingerprint,
        generatedSpec: dashboardBriefSpec,
        generatedAt,
        providerClientId: client.id,
      },
    });

    const result = await generateDashboardBrief({ workspaceId, fingerprintInput: input });

    expect(result.status).toBe("ready");
    expect(result.spec).toEqual(dashboardBriefSpec);
    expect(result.generatedAt).toBe(generatedAt.toISOString());
  });

  it("persists provider errors as failed brief state", async () => {
    const { workspaceId } = await seedWorkspace("Provider failure workspace");
    await seedDefaultClient();

    const result = await generateDashboardBrief({ workspaceId, fingerprintInput: baseFingerprintInput(), force: true });

    expect(result.status).toBe("failed");
    expect(result.canGenerate).toBe(false);
    expect(result.errorMessage).toContain("Generated dashboard brief response invalid");
    const surface = await db.workspaceAiSurface.findUniqueOrThrow({
      where: { workspaceId_surface: { workspaceId, surface: "dashboard.brief" } },
    });
    expect(surface.status).toBe("failed");
    expect(surface.errorMessage).toContain("Generated dashboard brief response invalid");
  });


  it("uses stable fingerprints for equivalent dashboard facts", () => {
    const input = {
      needsAttention: [],
      inProgress: [],
      upcomingToday: [],
      autoCompleted: [],
      recentEvents: [],
      totalAutoCompleted: 0,
    };

    expect(fingerprintDashboardBriefInput(input)).toBe(fingerprintDashboardBriefInput({ ...input }));
  });

  it("includes prompt-visible facts in dashboard brief fingerprint", () => {
    const base = baseFingerprintInput();

    expect(fingerprint({ ...base, needsAttention: [attentionItem()] })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, inProgress: [inProgressItem()] })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, autoCompleted: [completedItem(1)] })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, recentEvents: [recentEvent(1)] })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, totalAutoCompleted: 1 })).not.toBe(fingerprint(base));
  });

  it("ignores facts outside dashboard brief prompt contract", () => {
    const base = baseFingerprintInput();
    const completed = Array.from({ length: 21 }, (_, index) => completedItem(index));
    const changedCompletedOutsidePrompt = completed.map((item, index) => index === 20 ? completedItem(index, { title: "Changed outside prompt" }) : item);
    const events = Array.from({ length: 31 }, (_, index) => recentEvent(index));
    const changedEventOutsidePrompt = events.map((event, index) => index === 30 ? recentEvent(index, { summary: "Changed outside prompt" }) : event);

    expect(fingerprint({ ...base, upcomingToday: [upcomingItem()] })).toBe(fingerprint(base));
    expect(fingerprint({ ...base, autoCompleted: completed })).toBe(fingerprint({ ...base, autoCompleted: changedCompletedOutsidePrompt }));
    expect(fingerprint({ ...base, recentEvents: events })).toBe(fingerprint({ ...base, recentEvents: changedEventOutsidePrompt }));
  });
});

describe("dashboard AI brief prompt", () => {
  it("defines an attention-first operating brief contract without duplicating dashboard modules", () => {
    const prompt = buildDashboardBriefPromptInput({
      needsAttention: [{
        taskId: "task-1",
        title: "Approve release plan",
        status: "WaitingForApproval",
        kind: "approval",
        reason: "Plan needs approval",
        latestOutput: null,
        updatedAt: "2026-07-03T00:00:00.000Z",
      }],
      inProgress: [],
      upcomingToday: [],
      autoCompleted: [],
      recentEvents: [],
      totalAutoCompleted: 0,
    });

    expect(prompt.rules).toContain("Treat this as an executive operating brief for Chrona Dashboard, not a task list or duplicate of the side modules.");
    expect(prompt.rules).toContain("If needsAttention has items, lead with what needs user action and why; prioritize approval, input, blocked, failed, then schedule risk.");
    expect(prompt.presentationContract).toMatchObject({
      sections: ["heading", "situation", "signals", "recommendedNextStep"],
      attentionPolicy: "needsAttention first; quiet all-clear when empty",
      duplicationPolicy: "summarize patterns; do not recreate Focus queue, Running now, Recent completions, or Recent activity lists",
    });
  });
});

describe("dashboard AI brief payload parsing", () => {
  it("rejects null provider payload with concise error", () => {
    expect(() => parseDashboardBriefPayload(null)).toThrow("Generated dashboard brief response invalid: expected JSON object with spec");
  });

  it("accepts parsed provider payload object", () => {
    expect(parseDashboardBriefPayload({
      summaryText: "Needs review",
      spec: dashboardBriefSpec,
    })).toMatchObject({ summaryText: "Needs review" });
  });
});

describe("dashboard brief tool audit result lookup", () => {
  it("reads accepted chrona_dashboard_brief result by session scope", async () => {
    const { workspaceId } = await seedWorkspace("Dashboard brief test");
    const scope = `workspace:${workspaceId}:dashboard.brief:fingerprint`;
    const correlationId = "dashboard-brief-operation";
    await db.rawEventLog.create({
      data: {
        workspaceId,
        taskSessionId: scope,
        source: "chrona_tool",
        direction: "inbound",
        rawType: "chrona.dashboard.brief",
        payloadHash: "dashboard-brief-input-hash",
        correlationId,
      },
    });
    await db.toolInvocation.create({
      data: {
        workspaceId,
        toolName: "chrona.dashboard.brief",
        status: "accepted",
        correlationId,
        outputPayload: {
          state: {
            result: { summaryText: "Needs review", spec: dashboardBriefSpec },
          },
        },
      },
    });

    await expect(dashboardBriefFromTool(scope)).resolves.toEqual({ summaryText: "Needs review", spec: dashboardBriefSpec });
  });

  it("ignores assistant text when accepted tool result is missing", async () => {
    await expect(dashboardBriefFromTool("workspace:missing:dashboard.brief:fingerprint")).resolves.toBeNull();
  });
});
