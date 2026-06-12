import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

export type TaskWorkspaceViewport = "desktop" | "tablet" | "mobile";


export type CreatedTaskWorkspaceTask = {
  taskId: string;
  workspaceId: string;
};

export async function createTaskWorkspaceTask(
  request: APIRequestContext,
  input: { title: string; description: string },
): Promise<CreatedTaskWorkspaceTask> {
  const workspaceResponse = await request.get("/api/workspaces/default");
  expect(workspaceResponse.ok()).toBeTruthy();

  const workspaceBody = (await workspaceResponse.json()) as {
    id?: string;
    workspace?: { id?: string };
    workspaceId?: string;
  };
  const workspaceId = workspaceBody.workspaceId ?? workspaceBody.id ?? workspaceBody.workspace?.id;
  expect(workspaceId).toBeTruthy();

  const createTaskResponse = await request.post("/api/tasks", {
    data: {
      workspaceId,
      title: input.title,
      description: input.description,
      priority: "Medium",
    },
  });
  expect(createTaskResponse.ok()).toBeTruthy();

  const createdTask = (await createTaskResponse.json()) as CreatedTaskWorkspaceTask;
  expect(createdTask.taskId).toBeTruthy();
  expect(createdTask.workspaceId).toBeTruthy();
  return createdTask;
}

export async function generateDebugTaskWorkspacePlan(
  request: APIRequestContext,
  taskId: string,
) {
  const createResponse = await request.post("/api/ai/clients", {
    data: {
      name: `E2E Debug Plan Client ${taskId}`,
      type: "debug",
      config: { profile: "deterministic" },
      isDefault: true,
    },
  });
  expect(createResponse.ok()).toBeTruthy();

  const created = (await createResponse.json()) as { client: { id?: string } };
  const clientId = created.client.id;
  expect(clientId).toBeTruthy();

  const bindResponse = await request.put(`/api/ai/clients/${clientId}/bindings`, {
    data: { features: ["generate_plan"] },
  });
  expect(bindResponse.ok()).toBeTruthy();

  const generationResponse = await request.post(`/api/tasks/${taskId}/plan/generations`, {
    data: { forceRefresh: true },
    headers: { accept: "text/event-stream" },
  });
  expect(generationResponse.ok()).toBeTruthy();
  await generationResponse.text();

  await expect.poll(async () => {
    const planResponse = await request.get(`/api/tasks/${taskId}/plan`);
    if (!planResponse.ok()) return null;
    const planBody = (await planResponse.json()) as { savedPlan?: { id?: string; status?: string } | null };
    return planBody.savedPlan?.id && planBody.savedPlan.status === "draft" ? planBody.savedPlan.id : null;
  }, { timeout: 20_000 }).not.toBeNull();

  const planResponse = await request.get(`/api/tasks/${taskId}/plan`);
  expect(planResponse.ok()).toBeTruthy();
  const planBody = (await planResponse.json()) as { savedPlan?: { id?: string } | null };
  const planId = planBody.savedPlan?.id;
  expect(planId).toBeTruthy();

  const acceptResponse = await request.post(`/api/tasks/${taskId}/plan/accept`, {
    data: { planId },
  });
  expect(acceptResponse.ok()).toBeTruthy();
}

export function taskWorkspaceScreenshotName(testInfo: TestInfo, label: string) {
  return `${testInfo.project.name}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
}

export async function setTaskWorkspaceViewport(page: Page, viewport: TaskWorkspaceViewport) {
  const size = viewport === "desktop"
    ? { width: 1440, height: 900 }
    : viewport === "tablet"
      ? { width: 1024, height: 768 }
      : { width: 390, height: 844 };
  await page.setViewportSize(size);
}

export async function gotoSeededTaskWorkspace(page: Page, workspaceId: string, taskId: string) {
  void workspaceId;
  await page.goto(`/en/tasks/${taskId}`);
  await expect(page.getByRole("heading", { name: /.+/ }).first()).toBeVisible();
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
