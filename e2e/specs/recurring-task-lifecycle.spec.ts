import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const TASK_URL = (taskId: string, workBlockId?: string) =>
  workBlockId
    ? `/en/tasks/${taskId}?workBlockId=${encodeURIComponent(workBlockId)}`
    : `/en/tasks/${taskId}`;

async function fetchDefaultWorkspaceId(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/workspaces/default");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { id?: string; workspaceId?: string };
  const workspaceId = body.workspaceId ?? body.id;
  expect(workspaceId).toBeTruthy();
  return workspaceId as string;
}

async function createRecurringTask(
  request: APIRequestContext,
  input: {
    workspaceId: string;
    title: string;
    rrule: string;
    anchorStart: string;
    anchorEnd: string;
  },
): Promise<{ taskId: string }> {
  const res = await request.post("/api/tasks", {
    data: {
      workspaceId: input.workspaceId,
      title: input.title,
      description: "E2E recurring task lifecycle",
      priority: "Medium",
      recurrenceRule: input.rrule,
      recurrenceAnchorStartAt: input.anchorStart,
      recurrenceAnchorEndAt: input.anchorEnd,
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { taskId: string };
  expect(body.taskId).toBeTruthy();
  return body;
}

async function waitForOccurrences(
  request: APIRequestContext,
  taskId: string,
  expectedCount: number,
): Promise<Array<{ workBlockId: string; isCurrent: boolean }>> {
  await expect
    .poll(async () => {
      const res = await request.get(`/api/tasks/${taskId}`);
      if (!res.ok()) return null;
      const body = (await res.json()) as {
        task: { recurrenceOccurrences?: Array<{ workBlockId: string; isCurrent: boolean }> };
      };
      const occs = body.task.recurrenceOccurrences ?? [];
      const materialized = occs.filter(
        (o): o is { workBlockId: string; isCurrent: boolean } =>
          typeof o.workBlockId === "string" && o.workBlockId.length > 0,
      );
      return materialized.length;
    }, { timeout: 15_000, intervals: [500, 1_000, 2_000] })
    .toBe(expectedCount);

  const res = await request.get(`/api/tasks/${taskId}`);
  const body = (await res.json()) as {
    task: { recurrenceOccurrences?: Array<{ workBlockId: string; isCurrent: boolean }> };
  };
  return (body.task.recurrenceOccurrences ?? []).filter(
    (o): o is { workBlockId: string; isCurrent: boolean } =>
      typeof o.workBlockId === "string" && o.workBlockId.length > 0,
  );
}

async function expectNoHorizontalScroll(page: Page) {
  await expect.poll(async () => page.evaluate(() => ({
    bodyOverflow: document.body.scrollWidth > window.innerWidth,
    documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
  }))).toEqual({ bodyOverflow: false, documentOverflow: false });
}

/**
 * Drive a navigation through the SPA — pushState, no full reload. The
 * page-state hook must re-hydrate the new occurrence from the loader
 * without pinning the previous header spec / state store.
 */
async function navigateToWorkBlock(page: Page, workBlockId: string) {
  await page.evaluate((id) => {
    const next = new URL(window.location.href);
    next.searchParams.set("workBlockId", id);
    window.history.pushState({}, "", next.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, workBlockId);
}

test.describe("Recurring task lifecycle", () => {
  test("expands a daily series and switches occurrences without a page refresh", async ({
    page,
    request,
  }, testInfo) => {
    const workspaceId = await fetchDefaultWorkspaceId(request);

    // Anchor on a stable future date so the spec survives any clock drift.
    const anchorStart = "2026-06-15T09:00:00.000Z";
    const anchorEnd = "2026-06-15T09:30:00.000Z";
    const task = await createRecurringTask(request, {
      workspaceId,
      title: `E2E Recurring ${testInfo.project.name} ${Date.now()}`,
      rrule: "FREQ=DAILY;COUNT=3",
      anchorStart,
      anchorEnd,
    });

    // Wait for the orchestrator's recurring-work-block-expansion worker to
    // materialize all 3 daily occurrences.
    const occurrences = await waitForOccurrences(request, task.taskId, 3);
    expect(occurrences).toHaveLength(3);
    const [first, second, third] = occurrences;
    expect(first && second && third).toBeTruthy();

    // Navigate to the task — no workBlockId, so the loader pins the first
    // occurrence by default. The occurrence dropdown only renders when the
    // series has > 1 occurrence.
    await page.goto(TASK_URL(task.taskId));
    const occurrenceTrigger = page.getByRole("button", { name: /Occurrence/ });
    await expect(occurrenceTrigger).toBeVisible();
    await expect(occurrenceTrigger).toContainText(/Mon, Jun 15/);

    // Push a new workBlockId via the SPA. The page must re-render with the
    // new occurrence's header — the prior occurrence's header spec /
    // state store must NOT bleed into the new view.
    await navigateToWorkBlock(page, second.workBlockId);
    await expect(occurrenceTrigger).toContainText(/Tue, Jun 16/, { timeout: 10_000 });

    // The third occurrence must be reachable the same way.
    await navigateToWorkBlock(page, third.workBlockId);
    await expect(occurrenceTrigger).toContainText(/Wed, Jun 17/, { timeout: 10_000 });

    // And back to the first — the round-trip must end with the same header
    // the initial render had.
    await navigateToWorkBlock(page, first.workBlockId);
    await expect(occurrenceTrigger).toContainText(/Mon, Jun 15/, { timeout: 10_000 });

    if (testInfo.project.name === "mobile") {
      await expectNoHorizontalScroll(page);
    }
  });
});
