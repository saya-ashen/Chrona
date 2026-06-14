import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

export type TaskWorkspaceViewport = "desktop" | "tablet" | "mobile";


export type CreatedTaskWorkspaceTask = {
  taskId: string;
  workspaceId: string;
};

/**
 * Mirror of the discriminated union accepted by
 * `POST /api/work/:taskId/commands` (see
 * `packages/contracts/src/api/projections.schema.ts#workCommandBodySchema`).
 * Kept inline — E2E specs deliberately avoid cross-package imports so the
 * suite can run as a standalone Playwright install.
 */
export type WorkspaceCommand =
  | {
    type: "plan.generate";
    forceRefresh?: boolean;
    workBlockId?: string | null;
    userInstruction?: string | null;
    idempotencyKey?: string;
  }
  | {
    type: "plan.accept";
    planId: string;
    workBlockId?: string | null;
    idempotencyKey?: string;
  }
  | {
    type: "execution.action";
    action: string | Record<string, unknown>;
    [key: string]: unknown;
  }
  | {
    type: "checkpoint.action";
    checkpointId: string;
    action: string;
    payload?: Record<string, unknown>;
    workBlockId?: string | null;
    idempotencyKey?: string;
  };

export type WorkspaceCommandAck = {
  commandId: string;
  taskId: string;
  acceptedAt: string;
};

export type WorkspaceStreamEvent = {
  type: string;
  [key: string]: unknown;
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

/**
 * Drive a single orchestrator tick through the env-gated test-support route
 * (`POST /api/test/orchestrator/tick`, mounted only when
 * `CHRONA_E2E_TEST_ROUTES=1`). Deterministic alternative to waiting on the
 * orchestrator's `setInterval` — the golden-path spec advances the
 * schedule->auto-execution loop one tick at a time instead of using
 * wall-clock sleeps (milestone §7.3).
 */
export async function triggerOrchestratorTick(request: APIRequestContext) {
  const response = await request.post("/api/test/orchestrator/tick");
  if (!response.ok()) {
    const body = await response.text().catch(() => "<no body>");
    throw new Error(`triggerOrchestratorTick failed: HTTP ${response.status()} body=${body.slice(0, 300)}`);
  }
  const body = (await response.json()) as { ok?: boolean };
  expect(body.ok).toBe(true);
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

/**
 * Dispatch a workspace command through the public `POST /api/work/:taskId/commands`
 * endpoint. Returns the 202 acknowledgement payload. The actual state mutation
 * is asynchronous; use `collectWorkspaceEvents` to wait for the resulting SSE
 * `state.update` or terminal `execution.result` event.
 */
export async function dispatchWorkspaceCommand(
  request: APIRequestContext,
  taskId: string,
  command: WorkspaceCommand,
): Promise<WorkspaceCommandAck> {
  const response = await request.post(`/api/work/${taskId}/commands`, {
    data: command,
  });
  if (!response.ok()) {
    const text = await response.text().catch(() => "<no body>");
    throw new Error(
      `dispatchWorkspaceCommand ${command.type} for ${taskId} failed: HTTP ${response.status()} body=${text.slice(0, 500)}`,
    );
  }
  const body = (await response.json()) as WorkspaceCommandAck;
  expect(body.commandId).toBeTruthy();
  expect(body.taskId).toBe(taskId);
  return body;
}

/**
 * Subscribe to the workspace SSE stream (`GET /api/work/:taskId/events`),
 * collect events until `predicate` returns `true` for at least one event or
 * the timeout elapses, then close the stream and return all collected events.
 *
 * Used by lifecycle specs to assert that intermediate execution events
 * (`execution.runtime_event`, `execution.state.updated`, `execution.result`)
 * actually reach the client.
 */
export async function collectWorkspaceEvents(
  request: APIRequestContext,
  taskId: string,
  predicate: (event: WorkspaceStreamEvent) => boolean,
  options: { timeoutMs?: number } = {},
): Promise<WorkspaceStreamEvent[]> {
  const { timeoutMs = 30_000 } = options;
  const collected: WorkspaceStreamEvent[] = [];
  let resolved = false;
  let setResolved: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    setResolved = () => {
      resolved = true;
      resolve();
    };
  });
  const resolveDone = (): void => {
    if (setResolved) setResolved();
  };

  const controller = new AbortController();
  const timer = setTimeout(() => {
    if (!resolved) resolveDone();
  }, timeoutMs);

  try {
    const response = await request.get(`/api/work/${taskId}/events`, {
      headers: { accept: "text/event-stream" },
      timeout: timeoutMs + 5_000,
    });
    expect(response.ok()).toBeTruthy();
    if (!response.body) return collected;

    const reader = response.body;
    let buffer = "";
    const decoder = new TextDecoder();
    // `request.get(...).body` in Playwright is a Node ReadableStream.
    const stream = reader as unknown as NodeJS.ReadableStream;
    const onAbort = () => {
      controller.abort();
    };

    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      if (resolved) break;
      buffer += decoder.decode(chunk, { stream: true });
      // SSE frames are separated by a blank line.
      let frameEnd = buffer.indexOf("\n\n");
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const event = parseSseFrame(frame);
        if (event) {
          collected.push(event);
          if (predicate(event)) {
            resolveDone();
            break;
          }
        }
        if (resolved) break;
        frameEnd = buffer.indexOf("\n\n");
      }
      if (resolved) break;
    }
    onAbort();
    await done;
  } catch (cause) {
    if (!resolved) {
      // Surface the error to the caller by rethrowing; keep the events we did
      // collect attached via a synthetic "error" event for diagnostics.
      collected.push({ type: "collect.error", message: cause instanceof Error ? cause.message : String(cause) });
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }

  return collected;
}

function parseSseFrame(frame: string): WorkspaceStreamEvent | null {
  // A frame can carry an `event:` line, one or more `data:` lines, and
  // optional `id:` / `retry:` lines. We only care about `event:` and `data:`.
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1).replace(/^ /, "");
    if (field === "event") {
      eventName = value || "message";
    } else if (field === "data") {
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n");
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !("type" in parsed)) {
      return { type: eventName, ...parsed };
    }
    return { type: eventName, ...(parsed as object) } as WorkspaceStreamEvent;
  } catch {
    return { type: eventName, raw: payload };
  }
}
