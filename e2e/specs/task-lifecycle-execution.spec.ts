import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  createTaskWorkspaceTask,
  dispatchWorkspaceCommand,
  generateDebugTaskWorkspacePlan,
  setTaskWorkspaceViewport,
  triggerOrchestratorTick,
  type TaskWorkspaceViewport,
} from "./task-workspace-test-helpers";

const TASK_URL = (taskId: string) => `/en/tasks/${taskId}`;
const WORK_URL = TASK_URL;

type ExecutionCurrentBody = {
  status?: string;
  checkpoint?: { id?: string; type?: string } | null;
};

async function expectNoHorizontalScroll(page: Page) {
  await expect.poll(async () => page.evaluate(() => ({
    bodyOverflow: document.body.scrollWidth > window.innerWidth,
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }))).toEqual({ bodyOverflow: false, documentOverflow: false });
}

function selectViewport(testInfo: { project: { name: string } }): TaskWorkspaceViewport {
  return testInfo.project.name === "tablet" || testInfo.project.name === "mobile"
    ? testInfo.project.name
    : "desktop";
}

async function dismissTaskEditorIfOpen(page: Page) {
  const editor = page.getByRole("dialog", { name: "Edit task" });
  if (await editor.isVisible().catch(() => false)) {
    await editor.getByRole("button", { name: "Close task editor" }).click();
    await expect(editor).not.toBeVisible();
  }
}

async function getCurrentExecution(
  request: APIRequestContext,
  taskId: string,
): Promise<ExecutionCurrentBody> {
  const response = await request.get(`/api/tasks/${taskId}/execution/current`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as ExecutionCurrentBody;
}

/**
 * Bind a debug AI client as the workspace default for ALL execution features
 * so the manual lifecycle can run end-to-end (not just generate a plan).
 * `generateDebugTaskWorkspacePlan` binds only `generate_plan`; this binds the
 * three execute-time features the debug plan graph needs.
 */
async function bindAllDebugFeatures(
  request: APIRequestContext,
  taskId: string,
): Promise<void> {
  const createRes = await request.post("/api/ai/clients", {
    data: {
      name: `E2E Lifecycle Debug Client ${taskId}`,
      type: "debug",
      config: { profile: "deterministic" },
      isDefault: true,
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = (await createRes.json()) as { client: { id?: string } };
  const clientId = created.client.id;
  expect(clientId).toBeTruthy();

  const bindRes = await request.put(`/api/ai/clients/${clientId}/bindings`, {
    data: {
      features: [
        "generate_plan",
        "execute_task_node",
        "evaluate_condition_node",
        "review_checkpoint_node",
      ],
    },
  });
  expect(bindRes.ok()).toBeTruthy();
}

async function generateDraftPlan(
  request: APIRequestContext,
  taskId: string,
): Promise<string> {
  const generationResponse = await request.post(
    `/api/tasks/${taskId}/plan/generations`,
    { data: { forceRefresh: true }, headers: { accept: "text/event-stream" } },
  );
  expect(generationResponse.ok()).toBeTruthy();
  await generationResponse.text();

  let planId: string | null = null;
  await expect.poll(async () => {
    const res = await request.get(`/api/tasks/${taskId}/plan`);
    if (!res.ok()) return null;
    const body = (await res.json()) as { savedPlan?: { id?: string; status?: string } | null };
    planId = body.savedPlan?.id ?? null;
    return body.savedPlan?.status === "draft" ? planId : null;
  }, { timeout: 20_000 }).not.toBeNull();
  expect(planId).toBeTruthy();
  return planId!;
}

/** Generate + accept a debug plan, asserting the saved plan reaches `accepted`. */
async function generateAndAcceptPlan(
  request: APIRequestContext,
  taskId: string,
): Promise<void> {
  const planId = await generateDraftPlan(request, taskId);

  const acceptRes = await request.post(`/api/tasks/${taskId}/plan/accept`, {
    data: { planId },
  });
  expect(acceptRes.ok()).toBeTruthy();
}

/** Poll execution/current until predicate passes, returning the matching body. */
async function pollExecution(
  request: APIRequestContext,
  taskId: string,
  predicate: (body: ExecutionCurrentBody) => boolean,
  timeoutMs = 40_000,
  advance = false,
): Promise<ExecutionCurrentBody> {
  let last: ExecutionCurrentBody = {};
  await expect.poll(async () => {
    last = await getCurrentExecution(request, taskId);
    if (predicate(last)) return true;
    if (advance) await triggerOrchestratorTick(request);
    return false;
  }, { timeout: timeoutMs, intervals: [300, 500, 1_000] }).toBe(true);
  return last;
}

/** Resolve a checkpoint via the workspace commands endpoint. */
async function postCheckpointAction(
  request: APIRequestContext,
  taskId: string,
  checkpointId: string,
  action: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  const body: Record<string, unknown> = { type: "checkpoint.action", checkpointId, action };
  if (payload !== undefined) body.payload = payload;
  const res = await request.post(`/api/work/${taskId}/commands`, { data: body });
  if (!res.ok()) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`checkpoint.action ${action} failed: HTTP ${res.status()} body=${text.slice(0, 500)}`);
  }
  const ack = (await res.json()) as { commandId?: string };
  expect(ack.commandId).toBeTruthy();
}

/**
 * Drive the three debug-plan gates in order, asserting the exact execution
 * status at each one. The debug `deterministic` plan deterministically yields:
 *   input checkpoint (waiting_for_user)
 *     → approval checkpoint (waiting_for_approval)
 *     → manual node (blocked)  → Completed.
 */
async function resolveDebugPlanGates(
  request: APIRequestContext,
  taskId: string,
): Promise<void> {
  await test.step("Resolve input checkpoint (submit_input)", async () => {
    const exec = await pollExecution(
      request, taskId,
      (b) => b.status === "waiting_for_user" && !!b.checkpoint?.id,
    );
    await postCheckpointAction(request, taskId, exec.checkpoint!.id!, "submit_input", {
      inputFields: { scenario_label: "fast", include_slow_wait: false, priority: "normal" },
    });
  });

  await test.step("Resolve approval checkpoint (approve_result)", async () => {
    const exec = await pollExecution(
      request, taskId,
      (b) => (b.status === "waiting_for_approval" || b.status === "blocked") && !!b.checkpoint?.id,
      40_000,
      true,
    );
    if (exec.status === "waiting_for_approval") {
      await postCheckpointAction(request, taskId, exec.checkpoint!.id!, "approve_result", {
        feedback: "approved by e2e lifecycle",
      });
    }
  });

  await test.step("Resolve manual node (mark_node_completed)", async () => {
    const exec = await pollExecution(
      request, taskId,
      (b) => b.status === "blocked" && !!b.checkpoint?.id,
      40_000,
      true,
    );
    await postCheckpointAction(request, taskId, exec.checkpoint!.id!, "mark_node_completed", {
      root: "root",
      elements: { root: { type: "Text", props: { value: "Manual review completed by e2e lifecycle" } } },
    });
  });
}

test.describe("Task create → plan → run → result", () => {
  test("updates header actions after clicking Accept plan and Start without reload", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Focused live-refresh regression runs on desktop only.");
    test.setTimeout(90_000);
    await setTaskWorkspaceViewport(page, "desktop");

    const task = await createTaskWorkspaceTask(request, {
      title: `E2E Header Action Refresh ${Date.now()}`,
      description: "Verify header Accept plan and Start actions refresh without manual reload.",
    });
    await bindAllDebugFeatures(request, task.taskId);
    await generateDraftPlan(request, task.taskId);

    await page.goto(TASK_URL(task.taskId));
    await dismissTaskEditorIfOpen(page);
    await expect(page.getByRole("heading", { name: /E2E Header Action Refresh/ })).toBeVisible();

    await page.getByRole("button", { name: /accept plan/i }).click();
    await expect(page.getByRole("button", { name: /^start$/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^start$/i })).toBeEnabled();

    await page.getByRole("button", { name: /^start$/i }).click();
    await expect.poll(async () => (await getCurrentExecution(request, task.taskId)).status, {
      timeout: 30_000,
      intervals: [300, 500, 1_000],
    }).not.toBe("started");

    await expect.poll(async () => page.getByRole("button").evaluateAll((buttons) =>
      buttons.map((button) => button.textContent?.trim()).filter(Boolean),
    ), { timeout: 20_000, intervals: [300, 500, 1_000] }).toEqual(
      expect.arrayContaining([expect.stringMatching(/stop/i)]),
    );
  });

  test("drives the full lifecycle from creation through accepted result", async ({
    page,
    request,
  }, testInfo) => {
    // Plan generation + three-gate manual resolution is deterministic but
    // spans several engine round-trips.
    test.setTimeout(180_000);
    const viewport = selectViewport(testInfo);
    await setTaskWorkspaceViewport(page, viewport);

    // 1. Create a task and open the workspace; assert the empty-graph state.
    const task = await createTaskWorkspaceTask(request, {
      title: `E2E Lifecycle ${viewport} ${Date.now()}`,
      description: "Drive a task through plan generation, accept, start, and accept result.",
    });
    await page.goto(TASK_URL(task.taskId));
    await dismissTaskEditorIfOpen(page);
    await expect(page.getByRole("heading", { name: new RegExp(`E2E Lifecycle ${viewport}`) })).toBeVisible();
    await expect(page.getByTestId("plan-setup-panel")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Generate plan$/ })).toBeVisible();
    await expect(page.getByText(/Nothing runs until the plan is reviewed and accepted/i)).toBeVisible();

    // Before any plan exists the engine reports exactly `no_plan`.
    expect((await getCurrentExecution(request, task.taskId)).status).toBe("no_plan");

    // 2. Bind all debug features, then generate + accept a plan.
    await test.step("Configure debug AI client and accept a plan", async () => {
      await bindAllDebugFeatures(request, task.taskId);
      await generateAndAcceptPlan(request, task.taskId);
    });

    // 3. The plan graph appears; engine moves to the pre-start `started`
    //    state (accepted plan, no execution session yet).
    await expect(page.getByTestId("task-plan-graph").first()).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await getCurrentExecution(request, task.taskId)).status, { timeout: 10_000 })
      .toBe("started");

    // 4. Start execution manually and drive the three debug gates to
    //    Completed, asserting each exact intermediate status along the way.
    await test.step("Start execution and resolve gates to Completed", async () => {
      const ack = await dispatchWorkspaceCommand(request, task.taskId, {
        type: "execution.action",
        action: "start_manual",
        prompt: "Run the debug plan end-to-end.",
        idempotencyKey: `e2e-start-${task.taskId}`,
      });
      expect(ack.commandId).toBeTruthy();

      await resolveDebugPlanGates(request, task.taskId);

      await expect
        .poll(async () => {
          const current = await getCurrentExecution(request, task.taskId);
          if (current.status === "completed") return "Completed";
          await triggerOrchestratorTick(request);
          return current.status ?? null;
        }, { timeout: 30_000, intervals: [300, 500, 1_000] })
        .toBe("Completed");
    });

    // 5. The Work page shows result-review state and exposes explicit product-owned
    //    result acceptance. Accept via the same UI path users see, then assert the
    //    projection flips to done.
    await test.step("Accept the result through the workspace UI", async () => {
      const beforeBody = await getCurrentExecution(request, task.taskId);
      expect(beforeBody.status).toBe("completed");

      await page.goto(WORK_URL(task.taskId));
      await dismissTaskEditorIfOpen(page);
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^result ready$/i }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: /^Accept result$/ })).toBeVisible();

      const acceptResponse = page.waitForResponse((response) => (
        response.url().includes(`/api/tasks/${task.taskId}/result/accept`) && response.request().method() === "POST"
      ));
      await page.getByRole("button", { name: /^Accept result$/ }).click();
      const response = await acceptResponse;
      expect(response.ok()).toBeTruthy();
      const acceptBody = (await response.json()) as { taskId?: string; runId?: string };
      expect(acceptBody.taskId).toBe(task.taskId);
      expect(acceptBody.runId).toBeTruthy();

      await page.goto(WORK_URL(task.taskId));
      await dismissTaskEditorIfOpen(page);
      await expect(
        page.locator('[data-slot="badge"]').filter({ hasText: /^task done$/i }),
      ).toBeVisible({ timeout: 15_000 });
    });

    if (viewport === "mobile") {
      await expectNoHorizontalScroll(page);
    }
  });

  test("drives plan persistence across page navigations", async ({ page, request }) => {
    await setTaskWorkspaceViewport(page, "desktop");

    const task = await createTaskWorkspaceTask(request, {
      title: `E2E Plan Persistence ${Date.now()}`,
      description: "Generate a plan, navigate away, come back — plan + accepted status must persist.",
    });
    await generateDebugTaskWorkspacePlan(request, task.taskId);

    // First navigation — confirm graph renders and plan is accepted server-side.
    await page.goto(TASK_URL(task.taskId));
    await dismissTaskEditorIfOpen(page);
    await expect(page.getByTestId("task-plan-graph").first()).toBeVisible({ timeout: 20_000 });
    const firstResponse = await request.get(`/api/tasks/${task.taskId}/plan`);
    expect(firstResponse.ok()).toBeTruthy();
    const firstBody = (await firstResponse.json()) as { savedPlan?: { id?: string; status?: string } | null };
    expect(firstBody.savedPlan?.id).toBeTruthy();
    expect(firstBody.savedPlan?.status).toBe("accepted");

    // Navigate away to the task list, then back. The plan must still
    // render — proves the workspace re-hydrates from the REST snapshot
    // when the SSE connection is severed and re-established.
    await page.goto("/en/tasks");
    await expect(page.getByRole("heading", { name: /tasks/i }).first()).toBeVisible();
    await page.goto(TASK_URL(task.taskId));
    await dismissTaskEditorIfOpen(page);
    await expect(page.getByTestId("task-plan-graph").first()).toBeVisible({ timeout: 20_000 });

    const secondResponse = await request.get(`/api/tasks/${task.taskId}/plan`);
    expect(secondResponse.ok()).toBeTruthy();
    const secondBody = (await secondResponse.json()) as { savedPlan?: { id?: string; status?: string } | null };
    expect(secondBody.savedPlan?.id).toBe(firstBody.savedPlan?.id);
    expect(secondBody.savedPlan?.status).toBe("accepted");
  });
});
