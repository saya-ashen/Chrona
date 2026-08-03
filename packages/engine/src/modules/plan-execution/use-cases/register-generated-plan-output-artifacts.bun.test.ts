import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { NodeDeliverableDeclaration } from "@chrona/contracts/ai";
import { db } from "@/lib/db";
import { aiArtifactRef, registerNodeDeliverables } from "./register-generated-plan-output-artifacts";

let dataDir = "";
const createdWorkspaceIds: string[] = [];

async function seedRun() {
  const workspace = await db.workspace.create({
    data: { name: `Deliverable test ${crypto.randomUUID()}`, status: "Active", defaultRuntime: "test" },
  });
  createdWorkspaceIds.push(workspace.id);
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Register a generated deliverable",
      priority: "Medium",
      executionRuntime: "test",
      executionConfig: {},
      status: "Running",
    },
  });
  const taskSession = await db.taskSession.create({
    data: { taskId: task.id, runtimeName: "test", sessionKey: `deliverable-${crypto.randomUUID()}` },
  });
  const run = await db.run.create({
    data: {
      taskId: task.id,
      taskSessionId: taskSession.id,
      runtimeName: "test",
      status: "Running",
      triggeredBy: "system",
    },
  });
  await mkdir(join(dataDir, "generated", run.id), { recursive: true });
  return { workspace, task, run };
}

function generatedDeclaration(uri: `generated://${string}`): NodeDeliverableDeclaration {
  return {
    deliverableKey: "report",
    title: "Report",
    kind: "document",
    source: { type: "generated_file", uri },
  };
}
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "chrona-deliverables-"));
  process.env.CHRONA_DATA_DIR = dataDir;
  await mkdir(join(dataDir, "generated"), { recursive: true });
});

afterEach(async () => {
  for (const workspaceId of createdWorkspaceIds.splice(0)) {
    await db.artifact.deleteMany({ where: { workspaceId } });
    await db.run.deleteMany({ where: { task: { workspaceId } } });
    await db.task.deleteMany({ where: { workspaceId } });
    await db.workspace.deleteMany({ where: { id: workspaceId } });
  }
  delete process.env.CHRONA_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("registerNodeDeliverables", () => {
  it("registers immutable file facts and reuses the same Artifact on replay", async () => {
    const { workspace, task, run } = await seedRun();
    await writeFile(join(dataDir, "generated", run.id, "report.md"), "# Result\n\nComplete.\n");
    const input = {
      workspaceId: workspace.id,
      taskId: task.id,
      runId: run.id,
      taskSessionId: run.taskSessionId,
      workBlockId: run.workBlockId,
      sourceNodeId: "node-1",
      declarations: [generatedDeclaration(`generated://${run.id}/report.md`)],
    };

    const first = await registerNodeDeliverables(input);
    const replay = await registerNodeDeliverables(input);
    const artifacts = await db.artifact.findMany({ where: { runId: run.id } });

    expect(replay).toEqual(first);
    expect(artifacts).toHaveLength(1);
    expect(first[0]).toMatchObject({
      artifactRef: aiArtifactRef(artifacts[0]!.id),
      deliverableKey: "report",
      sourceNodeRef: "node-1",
      status: "current",
    });
    expect(artifacts[0]?.metadata).toMatchObject({
      checksumAlgorithm: "sha256",
      mimeType: "text/markdown",
      size: 20,
      sourceNodeId: "node-1",
      deliverableKey: "report",
    });
  });

  it("registers against an explicitly owned completed Run for compensation", async () => {
    const { workspace, task, run } = await seedRun();
    await db.run.update({
      where: { id: run.id },
      data: { status: "Completed", endedAt: new Date() },
    });
    await writeFile(join(dataDir, "generated", run.id, "completed-report.md"), "# Completed result\n");

    const deliverables = await registerNodeDeliverables({
      workspaceId: workspace.id,
      taskId: task.id,
      runId: run.id,
      taskSessionId: run.taskSessionId,
      workBlockId: run.workBlockId,
      sourceNodeId: "node-1",
      declarations: [generatedDeclaration(`generated://${run.id}/completed-report.md`)],
    });

    expect(deliverables).toHaveLength(1);
    expect(await db.artifact.count({ where: { runId: run.id } })).toBe(1);
  });

  it("rejects a same-task Run outside the requested execution session scope", async () => {
    const { workspace, task, run } = await seedRun();
    const foreignSession = await db.taskSession.create({
      data: { taskId: task.id, runtimeName: "test", sessionKey: `foreign-${crypto.randomUUID()}` },
    });
    await writeFile(join(dataDir, "generated", run.id, "scoped.md"), "# Scoped\n");

    await expect(registerNodeDeliverables({
      workspaceId: workspace.id,
      taskId: task.id,
      taskSessionId: foreignSession.id,
      workBlockId: run.workBlockId,
      runId: run.id,
      sourceNodeId: "node-1",
      declarations: [generatedDeclaration(`generated://${run.id}/scoped.md`)],
    })).rejects.toThrow("Canonical Run is unavailable");
    expect(await db.artifact.count({ where: { taskId: task.id } })).toBe(0);
  });

  it("rejects traversal and symlinks that escape the generated root", async () => {
    const { workspace, task, run } = await seedRun();
    const outside = join(dataDir, "outside.txt");
    await writeFile(outside, "secret");
    await symlink(outside, join(dataDir, "generated", run.id, "leak.txt"));
    const base = {
      workspaceId: workspace.id,
      taskId: task.id,
      taskSessionId: run.taskSessionId,
      workBlockId: run.workBlockId,
      runId: run.id,
      sourceNodeId: "node-1",
    };

    await expect(registerNodeDeliverables({
      ...base,
      declarations: [generatedDeclaration("generated://../outside.txt")],
    })).rejects.toThrow("inside the generated-files root");
    await expect(registerNodeDeliverables({
      ...base,
      declarations: [generatedDeclaration(`generated://${run.id}/leak.txt`)],
    })).rejects.toThrow("escapes the generated-files root");
  });

  it("detects path mutation and rejects Artifact refs owned by another Run", async () => {
    const { workspace, task, run } = await seedRun();
    const otherRun = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "test",
        status: "Running",
        triggeredBy: "system",
      },
    });
    const foreign = await db.artifact.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        runId: otherRun.id,
        type: "file",
        title: "Foreign",
        uri: "generated://foreign.txt",
      },
    });
    const reportPath = join(dataDir, "generated", run.id, "report.json");
    await writeFile(reportPath, "{\"version\":1}");
    const base = {
      workspaceId: workspace.id,
      taskId: task.id,
      taskSessionId: run.taskSessionId,
      workBlockId: run.workBlockId,
      runId: run.id,
      sourceNodeId: "node-1",
    };
    await registerNodeDeliverables({
      ...base,
      declarations: [generatedDeclaration(`generated://${run.id}/report.json`)],
    });
    await writeFile(reportPath, "{\"version\":2}");

    await expect(registerNodeDeliverables({
      ...base,
      declarations: [generatedDeclaration(`generated://${run.id}/report.json`)],
    })).rejects.toThrow("changed after registration");
    await expect(registerNodeDeliverables({
      ...base,
      declarations: [{
        deliverableKey: "foreign",
        title: "Foreign",
        kind: "document",
        source: { type: "existing_artifact", artifactRef: aiArtifactRef(foreign.id) },
      }],
    })).rejects.toThrow("Unknown artifact reference");
  });
});
