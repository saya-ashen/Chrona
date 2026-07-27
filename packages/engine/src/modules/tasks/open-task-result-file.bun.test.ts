import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { resetTestDb, seedTask, seedWorkspace } from "../../../../../apps/server/src/__tests__/bun-test-helpers";
import { generatedFilesRoot } from "./result-file-access";
import { openTaskResultFile } from "./open-task-result-file";
import { aiArtifactRef } from "../plan-execution/use-cases/register-generated-plan-output-artifacts";

describe("openTaskResultFile", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it.each(["FileRef", "ResultDeliverable", "WorkspaceArtifactItem", "Table"])(
    "downloads generated files referenced by same-task %s results",
    async (componentType) => {
    const { workspaceId } = await seedWorkspace("Result download");
    const { taskId } = await seedTask(workspaceId, { title: "Create report" });
    const fixtureScope = `download-test-${randomUUID()}`;
    const reference = `generated://${fixtureScope}/node/report.md`;
    const fixtureRoot = join(generatedFilesRoot(), fixtureScope);
    const filePath = join(fixtureRoot, "node", "report.md");
    await mkdir(join(fixtureRoot, "node"), { recursive: true });
    await Bun.write(filePath, "# Report");

    await db.taskPlan.create({
      data: {
        planId: "download-plan",
        workspaceId,
        taskId,
        revision: 1,
        status: "Accepted",
        compiledPlan: {},
      },
    });
    const run = await db.run.create({
      data: { taskId, runtimeName: "test", status: "Completed", triggeredBy: "user" },
    });
    const artifact = await db.artifact.create({
      data: { workspaceId, taskId, runId: run.id, type: "file", title: "Report", uri: reference },
    });
    await db.event.create({
      data: {
        workspaceId,
        taskId,
        runId: run.id,
        planId: "download-plan",
        eventType: "provider.run_completed",
        actorType: "runtime",
        source: "provider",
        payload: {},
        ingestSequence: 1,
      },
    });
    await db.taskPlanRun.create({
      data: {
        workspaceId,
        taskId,
        planId: "download-plan",
        planRun: {
          planRun: {
            id: "persisted-run-metadata",
          },
          mutableGraph: {
            planOutput: {
              finalizedResult: {
                spec: {
                  root: "root",
                  elements: {
                    root: { type: "Stack", props: {}, children: ["report"] },
                    report: { type: componentType, props: { artifactRef: aiArtifactRef(artifact.id) } },
                  },
                },
              },
            },
          },
        },
      },
    });

    try {
      const result = await openTaskResultFile({ taskId, requestedPath: reference });
      expect(result.filename).toBe("report.md");
      expect(await result.file.text()).toBe("# Report");

      await expect(
        openTaskResultFile({
          taskId,
          requestedPath: `generated://${fixtureScope}/node/unreferenced.md`,
        }),
      ).rejects.toThrow(/not a registered task result Artifact/i);
    } finally {
      await rm(fixtureRoot, {
        recursive: true,
        force: true,
      });
    }
    },
  );
});
