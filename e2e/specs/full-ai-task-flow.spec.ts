import { expect, test } from "@playwright/test";

const SETTINGS_URL = "/en/settings?panel=ai-clients";
const SCHEDULE_URL = "/en/schedule";

test("full deterministic AI task flow persists plan updates", async ({ page, request }) => {
  const generatedPlan = {
    nodes: [
      {
        id: "node-collect-requirements",
        type: "step",
        title: "Collect requirements",
        objective: "Gather release constraints and scope",
        status: "pending",
        executionMode: "automatic",
      },
      {
        id: "node-draft-implementation",
        type: "step",
        title: "Draft implementation plan",
        objective: "Draft deterministic implementation steps",
        status: "pending",
        executionMode: "automatic",
      },
    ],
    edges: [
      {
        id: "edge-requirements-draft",
        fromNodeId: "node-collect-requirements",
        toNodeId: "node-draft-implementation",
        type: "sequential",
      },
    ],
  };

  const revisedNode = {
    id: "node-review-stakeholder",
    type: "checkpoint",
    title: "Review plan with stakeholder",
    objective: "Review the drafted plan with key stakeholder",
    status: "pending",
    executionMode: "manual",
  };

  await page.route("**/api/ai/clients/test", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, available: true, reason: "Mock connectivity OK" }),
    });
  });

  await page.route("**/api/ai/generate-task-plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        source: "openclaw",
        planGraph: {
          ...generatedPlan,
          status: "draft",
          summary: "Deterministic release checklist plan",
        },
        savedPlan: { id: "plan-mock-generated", status: "draft" },
      }),
    });
  });

  await page.route("**/api/ai/task-workspace/chat", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        assistantMessage: "Added stakeholder review checkpoint after drafting.",
        proposal: {
          summary: "Add stakeholder review checkpoint",
          confidence: "high",
          planPatch: {
            operation: "add_node",
            nodes: [revisedNode],
            edges: [
              {
                id: "edge-draft-review",
                fromNodeId: "node-draft-implementation",
                toNodeId: "node-review-stakeholder",
                type: "sequential",
              },
            ],
          },
          requiresConfirmation: false,
        },
      }),
    });
  });

  await page.goto(SETTINGS_URL);
  await expect(page.getByRole("heading", { name: /manage ai clients/i })).toBeVisible();
  await page.getByRole("button", { name: /add client/i }).click();
  await page.getByRole("textbox").first().fill("E2E Deterministic Client");
  await page.getByRole("combobox").selectOption("llm");
  await page.getByPlaceholder("https://api.openai.com/v1").fill("https://mock.local/v1");
  await page.getByPlaceholder("sk-...").fill("sk-mock-e2e");
  await page.getByRole("button", { name: /test availability/i }).first().click();
  await expect(page.getByText(/available/i).first()).toBeVisible();

  const createClientResp = page.waitForResponse((res) => res.url().includes("/api/ai/clients") && res.request().method() === "POST");
  await page.getByRole("button", { name: /^save$/i }).click();
  const createdClient = await (await createClientResp).json() as { id: string };
  expect(createdClient.id).toBeTruthy();

  // Use API for binding to keep E2E focused on end-to-end plan/chat workflow stability.
  const bindingsResp = await request.put(`/api/ai/clients/${createdClient.id}/bindings`, {
    data: { features: ["generate_plan", "chat"] },
  });
  expect(bindingsResp.ok()).toBeTruthy();

  await page.goto(SCHEDULE_URL);
  await page.getByRole("button", { name: "Quick add" }).click();
  await page.getByPlaceholder("Add title").fill("Prepare deterministic E2E release checklist");
  await page.getByPlaceholder("Add description").fill("Create a checklist, review it, and prepare final rollout notes.");

  const createTaskResp = page.waitForResponse((res) => res.url().includes("/api/tasks") && res.request().method() === "POST");
  await page.getByRole("button", { name: "Save" }).click();
  const createdTask = await (await createTaskResp).json() as { taskId: string; workspaceId: string };

  await page.goto(`/en/workspaces/${createdTask.workspaceId}/tasks/${createdTask.taskId}`);

  await request.post("/api/ai/generate-task-plan", { data: { taskId: createdTask.taskId } });
  await request.post(`/api/tasks/${createdTask.taskId}/plan`, {
    data: {
      operation: "add_node",
      nodes: generatedPlan.nodes,
      edges: generatedPlan.edges,
    },
  });
  await page.reload();

  await expect(page.getByText("Collect requirements").first()).toBeVisible();
  await expect(page.getByText("Draft implementation plan").first()).toBeVisible();

  const assistantInput = page.getByPlaceholder("Describe what to change...");
  await assistantInput.fill("Add a stakeholder review checkpoint after drafting.");
  await assistantInput.press("Enter");

  await expect(page.getByText("Add stakeholder review checkpoint").first()).toBeVisible();
  await page.getByRole("button", { name: /apply changes|accept & apply/i }).first().click();

  await expect(page.getByText("Review plan with stakeholder").first()).toBeVisible();

  const planStateResp = await request.get(`/api/tasks/${createdTask.taskId}/plan-state`);
  expect(planStateResp.ok()).toBeTruthy();
  const planState = await planStateResp.json() as {
    savedAiPlan?: { plan?: { nodes?: Array<{ title: string }> } };
  };
  const titles = (planState.savedAiPlan?.plan?.nodes ?? []).map((n) => n.title);
  expect(titles).toContain("Review plan with stakeholder");
});
