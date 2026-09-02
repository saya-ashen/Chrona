import { expect, test, type Locator } from "@playwright/test";
import {
  bindTaskDebugExecutionFeatures,
  createTaskWorkspaceTask,
  dispatchWorkspaceCommand,
  generateTaskWorkspacePlan,
  removeWorkspaceE2eAiClients,
  setTaskWorkspaceViewport,
} from "./task-workspace-test-helpers";

async function graphMetrics(graph: Locator) {
  return graph.evaluate((frame) => {
    const frameRect = frame.getBoundingClientRect();
    const flowRect = frame.querySelector(".react-flow")?.getBoundingClientRect();
    const visibleNodes = Array.from(frame.querySelectorAll(".react-flow__node"))
      .map((node) => node.getBoundingClientRect())
      .filter((rect) =>
        rect.width > 0 && rect.height > 0
        && rect.right > frameRect.left && rect.left < frameRect.right
        && rect.bottom > frameRect.top && rect.top < frameRect.bottom
      );
    return {
      frameWidth: frameRect.width,
      frameHeight: frameRect.height,
      flowWidth: flowRect?.width ?? 0,
      flowHeight: flowRect?.height ?? 0,
      visibleNodeCount: visibleNodes.length,
      minimumVisibleNodeWidth: Math.min(...visibleNodes.map((rect) => rect.width)),
    };
  });
}

test.describe("Task workspace layout", () => {
  test("keeps workspace execution regions reachable", async ({ page, request }, testInfo) => {
    const viewport = testInfo.project.name === "chromium" ? "desktop" : testInfo.project.name;
    const { taskId } = await createTaskWorkspaceTask(request, {
      title: `E2E Layout ${viewport}`,
      description: "Verify current task workspace layout.",
    });
    await page.goto(`/en/tasks/${taskId}`);

    await expect(page.getByText(`E2E Layout ${viewport}`).first()).toBeVisible();
    await expect(page.getByTestId("plan-setup-panel")).toBeVisible();

    const overflow = await page.evaluate(() => {
      const main = document.querySelector("main");
      return {
        bodyHorizontalOverflow: document.body.scrollWidth > window.innerWidth,
        documentHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        mainVerticalOverflow: main ? main.scrollHeight > main.clientHeight : false,
      };
    });
    expect(overflow.bodyHorizontalOverflow).toBe(false);
    expect(overflow.documentHorizontalOverflow).toBe(false);
    if (viewport === "desktop") {
      expect(overflow.mainVerticalOverflow).toBe(false);
    }
  });

  test("renders a readable full execution graph at desktop and tablet widths", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "This test sets both required viewport sizes directly.");
    const reactFlowSizeWarnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" && message.text().includes("parent container needs a width and a height")) {
        reactFlowSizeWarnings.push(message.text());
      }
    });

    const task = await createTaskWorkspaceTask(request, {
      title: "Readable execution graph",
      description: "Verify full graph layout and dialog sizing in a real browser.",
    });
    await bindTaskDebugExecutionFeatures(request, task.taskId);
    await generateTaskWorkspacePlan(request, task.taskId);
    await dispatchWorkspaceCommand(request, task.taskId, {
      type: "execution.action",
      action: "start_manual",
      idempotencyKey: `layout-graph-start-${task.taskId}`,
    });

    try {
      await setTaskWorkspaceViewport(page, "desktop");
      await page.goto(`/en/tasks/${task.taskId}`);
      await expect(page.getByRole("heading", { name: "Readable execution graph" })).toBeVisible();
      await page.getByRole("button", { name: "Full Dependencies and all paths" }).click();

      const inlineGraph = page.getByTestId("task-plan-graph");
      await expect.poll(async () => {
        const metrics = await graphMetrics(inlineGraph);
        return metrics.frameHeight >= 280
          && metrics.flowHeight >= 240
          && metrics.visibleNodeCount >= 2;
      }).toBe(true);

      await inlineGraph.getByRole("button", { name: "Expand graph" }).click();
      const dialog = page.getByRole("dialog", { name: "Full execution graph" });
      await expect(dialog).toBeVisible();
      await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(1_200);

      const fullGraph = dialog.getByTestId("task-plan-graph-full-dialog");
      await fullGraph.getByRole("button", { name: "Fit graph" }).click();
      await expect.poll(async () => {
        const metrics = await graphMetrics(fullGraph);
        return metrics.flowHeight >= 300
          && metrics.visibleNodeCount >= 4
          && metrics.minimumVisibleNodeWidth >= 80;
      }).toBe(true);

      await setTaskWorkspaceViewport(page, "tablet");
      await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(900);
      await expect.poll(async () => {
        const metrics = await graphMetrics(fullGraph);
        return metrics.frameWidth >= 850
          && metrics.flowHeight >= 280
          && metrics.visibleNodeCount >= 3;
      }).toBe(true);
      expect(reactFlowSizeWarnings).toEqual([]);
    } finally {
      await removeWorkspaceE2eAiClients(request);
    }
  });
});
