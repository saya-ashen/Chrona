import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { resetTestDb, seedTask, seedWorkspace } from "../../../../../apps/server/src/__tests__/bun-test-helpers";
import { generatedFilesRoot } from "./result-file-access";
import { openTaskResultFile } from "./open-task-result-file";

describe("openTaskResultFile", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("downloads only generated files referenced by the same task result", async () => {
    const { workspaceId } = await seedWorkspace("Result download");
    const { taskId } = await seedTask(workspaceId, { title: "Create report" });
    const reference = "generated://download-test/node/report.md";
    const filePath = join(generatedFilesRoot(), "download-test", "node", "report.md");
    await mkdir(join(generatedFilesRoot(), "download-test", "node"), { recursive: true });
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
    await db.taskPlanRun.create({
      data: {
        workspaceId,
        taskId,
        planId: "download-plan",
        planRun: {
          mutableGraph: {
            planOutput: {
              spec: {
                root: "root",
                elements: {
                  root: { type: "Stack", props: {}, children: ["report"] },
                  report: { type: "FileRef", props: { path: reference } },
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
          requestedPath: "generated://download-test/node/unreferenced.md",
        }),
      ).rejects.toThrow(/not referenced by the task result/i);
    } finally {
      await rm(join(generatedFilesRoot(), "download-test"), {
        recursive: true,
        force: true,
      });
    }
  });
});
