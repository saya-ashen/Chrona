import { expect, type Page, type TestInfo } from "@playwright/test";

export type TaskWorkspaceViewport = "desktop" | "mobile";

export function taskWorkspaceScreenshotName(testInfo: TestInfo, label: string) {
  return `${testInfo.project.name}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
}

export async function setTaskWorkspaceViewport(page: Page, viewport: TaskWorkspaceViewport) {
  await page.setViewportSize(viewport === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 });
}

export async function gotoSeededTaskWorkspace(page: Page, workspaceId: string, taskId: string) {
  await page.goto(`/en/workspaces/${workspaceId}/tasks/${taskId}`);
  await expect(page.getByRole("region", { name: "Workspace state" })).toBeVisible();
}

export function getPrimaryTaskWorkspaceAction(page: Page, name: RegExp | string) {
  return page.getByRole("button", { name }).first();
}

export async function captureTaskWorkspaceState(page: Page) {
  return {
    title: await page.title(),
    visibleText: await page.locator("body").innerText(),
    primaryActions: await page.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim()).filter(Boolean)),
  };
}
