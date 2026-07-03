import { beforeEach, describe, expect, it } from "bun:test";

import { db } from "@/lib/db";
import { aiClientRegistry } from "@/modules/ai";
import { buildDashboardBriefPromptInput, dashboardBriefFromTool, fingerprintDashboardBriefInput, parseDashboardBriefPayload } from "./dashboard-ai-surface";
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
