import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth)).toBe(true);
  if ((page.viewportSize()?.width ?? 1440) < 1280) {
    expect(await page.locator('nav[aria-label="Primary"] a').evaluateAll(links => links.every(link => link.getBoundingClientRect().right <= innerWidth))).toBe(true);
  }
}
async function read(request: APIRequestContext, taskId: string) { const response = await request.post("/api/work-records/read", { data: { taskId } }); expect(response.ok()).toBeTruthy(); return response.json(); }
async function create(request: APIRequestContext, suffix: string) {
  const response = await request.post("/api/work-records/capture", { data: { requestId: crypto.randomUUID(), title: `Meeting ${suffix}`, context: { kind: "meeting", window: { startsAt: "2031-01-15T10:00:00+08:00", endsAt: "2031-01-15T11:00:00+08:00", timezone: "Asia/Shanghai" } } } });
  expect(response.ok()).toBeTruthy(); return (await response.json()).receipt.taskId as string;
}
async function record(page: Page, summary: string, dimension?: string, value?: string) {
  await page.getByRole("button", { name: "Record progress", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("What happened").fill(summary);
  if (dimension) { await dialog.getByLabel("Status to update").click(); await page.getByRole("option", { name: dimension, exact: true }).click(); await dialog.getByLabel("Reported outcome").click(); await page.getByRole("option", { name: value!, exact: true }).click(); }
  return dialog;
}
async function confirmChange(page: Page) {
  await page.getByRole("region", { name: "Changes to review" }).getByRole("button", { name: "Confirm and apply", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("Evidence / decision note").fill("Checked the source; only update Chrona");
  await dialog.getByRole("button", { name: "Confirm and apply", exact: true }).click(); await expect(dialog).toHaveCount(0);
}
test("meeting workbench captures sources, independent reports, reviewed rescheduling/cancellation and results", async ({ page, request }, info) => {
  await page.goto("/en/work"); await expect(page.getByRole("heading", { name: "Work records", exact: true })).toBeVisible();
  if (info.project.name === "chromium") await expect(page.getByText("No work records yet", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Capture work", exact: true }).first().click();
  let dialog = page.getByRole("dialog");
  const title = `Product meeting ${info.project.name}`;
  await dialog.getByLabel("Title", { exact: true }).fill(title); await dialog.getByLabel("Starts", { exact: true }).fill("2031-01-15T10:00"); await dialog.getByLabel("Ends", { exact: true }).fill("2031-01-15T11:00");
  await dialog.getByLabel("Organizer", { exact: true }).fill("Design team"); await dialog.getByLabel("Participants (one per line)").fill("Saya\nProduct team");
  await dialog.getByLabel("Agenda and notes").fill("Discuss the next release. No external operations are authorized by this note.");
  await dialog.getByLabel("Next step", { exact: true }).fill("Check participation, then reconcile email and calendar outcomes");
  await dialog.getByRole("checkbox", { name: "Link a source now" }).check();
  await dialog.getByLabel("Service", { exact: true }).fill("gmail"); await dialog.getByLabel("Account identifier (no credentials)").fill(info.project.name);
  await dialog.getByLabel("Stable thread / event identifier").fill(`invite-${info.project.name}`); await dialog.getByLabel("Display name").fill("Original meeting invitation");
  await dialog.getByRole("button", { name: "Capture work", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/[^/?#]+$/);
  await expect(page.getByRole("heading", { name: title, exact: true, level: 1 })).toBeVisible();
  const taskId = page.url().split("/tasks/")[1].split(/[?#/]/)[0];
  await page.goto(`/en/tasks/${taskId}/work`);
  await expect(page.getByText("Original meeting invitation", { exact: true })).toBeVisible(); await noOverflow(page);
  await page.screenshot({ path: info.outputPath("meeting-overview.png"), fullPage: true });
  dialog = await record(page, "Participation was accepted", "Participation", "Accepted (reported)"); await dialog.getByRole("button", { name: "Save record", exact: true }).click(); await expect(dialog).toHaveCount(0);
  dialog = await record(page, "Email operation timed out; check before sending again", "Email reply", "Unknown outcome"); await dialog.getByLabel("Operation receipt / evidence reference (optional)").fill("mail-attempt:42"); await dialog.getByRole("button", { name: "Save record", exact: true }).click(); await expect(dialog).toHaveCount(0);
  dialog = await record(page, "Calendar operation failed; retry only after inspecting the receipt", "Calendar handling", "Failed (reported)"); await dialog.getByRole("button", { name: "Save record", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect((await read(request, taskId)).record.signals).toMatchObject({ participation: { value: "accepted" }, reply: { value: "unknown" }, calendar: { value: "failed" } });
  await page.getByRole("button", { name: "Link a source", exact: true }).click(); dialog = page.getByRole("dialog"); await dialog.getByLabel("Source type").click(); await page.getByRole("option", { name: "Calendar event", exact: true }).click();
  await dialog.getByLabel("Service", { exact: true }).fill("google-calendar"); await dialog.getByLabel("Account identifier (no credentials)").fill(info.project.name); await dialog.getByLabel("Stable thread / event identifier").fill(`event-${info.project.name}`); await dialog.getByLabel("Display name").fill("Calendar invitation"); await dialog.getByRole("button", { name: "Save record", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Change meeting", exact: true }).click(); dialog = page.getByRole("dialog"); await dialog.getByLabel("Starts", { exact: true }).fill("2031-01-16T14:00"); await dialog.getByLabel("Ends", { exact: true }).fill("2031-01-16T15:00"); await dialog.getByLabel("Reason for change").fill("Organizer proposed tomorrow afternoon"); await dialog.getByRole("button", { name: "Save proposal", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect((await read(request, taskId)).record.context.window.startsAt).toContain("2031-01-15"); await noOverflow(page);
  await page.getByRole("region", { name: "Changes to review" }).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath("meeting-change-review.png") }); await confirmChange(page);
  const moved = await read(request, taskId); expect(moved.record.context.window.startsAt).toBe("2031-01-16T06:00:00.000Z"); expect(moved.schedule.startsAt).toBe("2031-01-16T06:00:00.000Z");
  await page.getByRole("tab", { name: "Progress & receipts", exact: true }).click(); await expect(page.getByText("mail-attempt:42", { exact: false })).toBeVisible(); await noOverflow(page);
  await page.getByRole("tab", { name: "Results & materials", exact: true }).click(); await expect(page.getByText("No result version yet. Record work without a Provider or plan.")).toBeVisible(); await noOverflow(page);
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Change meeting", exact: true }).click(); dialog = page.getByRole("dialog"); await dialog.getByLabel("Change meeting", { exact: true }).click(); await page.getByRole("option", { name: "Cancel meeting", exact: true }).click(); await dialog.getByLabel("Reason for change").fill("Organizer cancelled"); await dialog.getByRole("button", { name: "Save proposal", exact: true }).click(); await expect(dialog).toHaveCount(0); await confirmChange(page);
  const cancelled = await read(request, taskId); expect(cancelled.record.cancelled).toBe(true); expect(cancelled.record.taskStatus).toBe("Ready"); expect(cancelled.schedule).toBeNull(); expect(cancelled.sources).toHaveLength(2);
  await page.reload(); await expect(page.getByText("Meeting cancelled", { exact: true }).first()).toBeVisible(); await expect(page.getByRole("button", { name: "Change meeting", exact: true })).toBeDisabled(); await noOverflow(page);
  await page.goto("/en/action-center"); await expect(page.getByRole("region", { name: "Work to follow up" }).getByRole("heading", { name: title })).toBeVisible();
});
test("retains exact request identity on lost response and makes stale changes explicit", async ({ page, request }, info) => {
  const taskId = await create(request, `recovery-${info.project.name}`); await page.goto(`/en/tasks/${taskId}/work`);
  const dialog = await record(page, "Durable note despite lost response");
  const ids: string[] = []; let lost = false;
  await page.route("**/api/work-records/update", async route => { ids.push(route.request().postDataJSON().requestId); if (!lost) { lost = true; await route.fetch(); await route.abort("failed"); } else await route.continue(); });
  await dialog.getByRole("button", { name: "Save record", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("not confirmed"); await dialog.getByRole("button", { name: "Retry same request", exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]); expect((await read(request, taskId)).total).toBe(2);
  let view = await read(request, taskId);
  await request.post("/api/work-records/update", { data: { taskId, requestId: crypto.randomUUID(), expectedRevision: view.record.revision, action: { type: "propose", change: { type: "cancel", reason: "Old cancellation" } } } });
  view = await read(request, taskId); await request.post("/api/work-records/update", { data: { taskId, requestId: crypto.randomUUID(), expectedRevision: view.record.revision, action: { type: "report", summary: "A newer invitation arrived" } } });
  await page.reload(); await expect(page.getByText("New information was recorded after this proposal.", { exact: false })).toBeVisible(); await expect(page.getByRole("button", { name: "Confirm and apply", exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: "Dismiss proposal", exact: true })).toBeEnabled(); await noOverflow(page);
});
test("enrolls existing manual work without replacing its task or published results", async ({ page, request }, info) => {
  const workspace = await (await request.get("/api/workspaces/default")).json();
  const response = await request.post("/api/tasks", { data: { workspaceId: workspace.workspaceId ?? workspace.id ?? workspace.workspace?.id, title: `Existing work ${info.project.name}`, taskExecutionMode: "manual", priority: "Medium", autoPlanGeneration: false, autoExecute: false } });
  expect(response.ok()).toBeTruthy(); const taskId = (await response.json()).taskId as string;
  const published = await request.post("/api/results/submit", { data: { taskId, requestId: crypto.randomUUID(), expectedRevision: null, content: { schemaVersion: 1, outcome: { title: "Preserved research", summary: "Existing result remains attached" }, readiness: { status: "ready", summary: "Ready for review" } } } });
  expect(published.ok()).toBeTruthy(); const versionId = (await published.json()).receipt.versionId;
  await page.goto(`/en/tasks/${taskId}/work`); await page.getByRole("button", { name: "Enable work recording", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(`Existing work ${info.project.name}`);
  await dialog.getByLabel("Agenda and notes").fill("Continue existing work"); await dialog.getByRole("button", { name: "Capture work", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Existing work ${info.project.name}`, exact: true })).toBeVisible();
  expect((await read(request, taskId)).record.taskId).toBe(taskId);
  await page.goto(`/en/tasks/${taskId}/work`);
  await page.getByRole("tab", { name: "Results & materials", exact: true }).click(); await expect(page.getByRole("heading", { name: "Preserved research", exact: true })).toBeVisible();
  const result = await (await request.post("/api/results/read", { data: { taskId } })).json(); expect(result.version.id).toBe(versionId); await noOverflow(page);
});
test("shows loading/read errors and keeps closed work read-only with materials accessible", async ({ page, request }, info) => {
  const taskId = await create(request, `states-${info.project.name}`); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let fail = true;
  await page.route("**/api/work-records/read", async route => { if (fail) { await gate; await route.abort("failed"); } else await route.continue(); });
  await page.goto(`/en/tasks/${taskId}/work`); await expect(page.getByText("Loading work…", { exact: true })).toBeVisible(); release(); await expect(page.getByRole("alert")).toContainText("not confirmed"); fail = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click(); await expect(page.getByRole("heading", { name: `Meeting states-${info.project.name}` })).toBeVisible();
  await page.getByRole("link", { name: "Task details", exact: true }).click(); await page.getByRole("button", { name: "Complete task", exact: true }).click(); await expect(page.getByRole("button", { name: "Reopen task", exact: true })).toBeVisible();
  await page.goto(`/en/tasks/${taskId}/work`); await expect(page.getByRole("button", { name: "Record progress", exact: true })).toBeDisabled(); await page.getByRole("tab", { name: "Results & materials", exact: true }).click(); await expect(page.getByRole("button", { name: "Publish a new version", exact: true })).toBeDisabled(); await noOverflow(page);
});
