import { beforeEach, describe, expect, it } from "bun:test";

import { db } from "@/lib/db";
import { aiClientRegistry } from "@/modules/ai";
import { getDashboard } from "./get-dashboard";
import { fingerprintDashboardBriefInput } from "./dashboard-ai-surface";

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

  it("marks cached ready brief dirty when dashboard facts change", async () => {
    const { workspaceId } = await seedWorkspace("Stale workspace");
    await seedDefaultClient();
    const initial = await getDashboard(workspaceId);
    await db.workspaceAiSurface.update({
      where: { workspaceId_surface: { workspaceId, surface: "dashboard.brief" } },
      data: {
        status: "ready",
        generatedSpec: { root: "root", elements: { root: { type: "Stack", props: {} } } },
        generatedAt: new Date(),
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
    expect(changed.aiBrief.spec).not.toBeNull();
    expect(changed.aiBrief.inputFingerprint).not.toBe(initial.aiBrief.inputFingerprint);
  });

  it("uses stable fingerprints for equivalent dashboard facts", () => {
    const input = {
      needsAttention: [],
      inProgress: [],
      autoCompleted: [],
      recentEvents: [],
      totalAutoCompleted: 0,
    };

    expect(fingerprintDashboardBriefInput(input)).toBe(fingerprintDashboardBriefInput({ ...input }));
  });
});
