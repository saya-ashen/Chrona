import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function createTask(request: APIRequestContext, name: string) {
  const workspace = await (await request.get("/api/workspaces/default")).json();
  const response = await request.post("/api/tasks", { data: { workspaceId: workspace.workspaceId ?? workspace.id ?? workspace.workspace?.id,
    title: `Independent result ${name}`, taskExecutionMode: "manual", priority: "Medium", autoPlanGeneration: false, autoExecute: false } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).taskId as string;
}
async function noOverflow(page: Page) { await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth)).toBe(true); }
async function read(request: APIRequestContext, taskId: string) {
  const response = await request.post("/api/results/read", { data: { taskId } }); expect(response.ok()).toBeTruthy(); return response.json();
}
async function compose(page: Page, title: string) {
  await page.getByRole("button", { name: "Publish a new version", exact: true }).click();
  await page.getByLabel("Result title", { exact: true }).fill(title);
  await page.getByLabel("Summary", { exact: true }).fill("Recorded without a provider or plan");
  await page.getByLabel("Readiness explanation").fill("Contributor reports ready for review");
}

test("records text/file/review, retains accepted version, downloads safely and survives reload without execution", async ({ page, request }, info) => {
  const taskId = await createTask(request, info.project.name);
  await page.goto(`/en/tasks/${taskId}`);
  await page.getByRole("main").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Results, versions and review", exact: true }).click();
  await expect(page.getByText("No result version yet. Record work without a Provider or plan.")).toBeVisible();
  await noOverflow(page);
  await compose(page, "Version one");
  const bytes = Buffer.from("<script>window.resultFileExecuted=true</script>" + "x".repeat(33000));
  await page.getByLabel("Choose file").setInputFiles({ name: "unsafe.html", mimeType: "text/html", buffer: bytes });
  await page.getByRole("button", { name: "Upload attachment", exact: true }).click();
  await page.getByRole("button", { name: "Attach finalized file to draft" }).click();
  await expect(page.getByLabel("Structured details (JSON)")).toHaveValue(/AF[0-9A-F]{12}/);
  await expect(page.getByRole("button", { name: "Publish version", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Publish version", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Version one", exact: true })).toBeVisible();
  await page.getByLabel("Review feedback").fill("Please improve the explanation");
  await page.getByRole("button", { name: "Request changes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review history" }).getByText("Please improve the explanation", { exact: true })).toBeVisible();
  await page.getByLabel("Review feedback").fill("Checked the file");
  await page.getByRole("button", { name: "Accept version", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review history" }).getByText("Checked the file", { exact: true })).toBeVisible();
  const first = await read(request, taskId);
  expect(first.state.accepted).toBe(true);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("unsafe.html");
  const stream = await download.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(createHash("sha256").update(Buffer.concat(chunks)).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(await page.evaluate(() => "resultFileExecuted" in window)).toBe(false);
  await compose(page, "Version two");
  await page.getByLabel("Source-reported readiness", { exact: true }).click();
  await page.getByRole("option", { name: "Blocked", exact: true }).click();
  await page.getByRole("button", { name: "Publish version", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Version two", exact: true })).toBeVisible();
  await expect(page.getByText("A newer version awaits review. The previously accepted version remains pinned.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept version", exact: true })).toBeDisabled();
  await noOverflow(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Version two", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Accepted", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Version one", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept version", exact: true })).toBeDisabled();
  await noOverflow(page);
  const context = await (await request.post("/api/results/context", { data: { taskId } })).json();
  expect(context.task.status).toBe("Ready");
  await page.getByRole("link", { name: "Back to task" }).click();
  await expect(page.locator('[data-domain="work-pages"]')).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Execution and task settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Complete task", exact: true })).toBeVisible();
  await expect(page.getByText(/Needs plan|Start AI/)).toHaveCount(0);
  await page.getByRole("button", { name: "Complete task", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reopen task", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Work results", exact: true }).click();
  await expect(page.getByText("Closed work does not accept new results or reviews.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish a new version", exact: true })).toBeDisabled();
});

test("recovers an interrupted upload after reload with only local metadata and reselected bytes", async ({ page, request }, info) => {
  const taskId = await createTask(request, `resume-${info.project.name}`);
  await page.goto(`/en/tasks/${taskId}/results`);
  await compose(page, "Before disconnect");
  const file = { name: "resume.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(40000, 42) };
  await page.getByLabel("Choose file").setInputFiles(file);
  let failed = false;
  await page.route("**/api/results/file", async (route) => {
    if (!failed && route.request().postDataJSON().action.type === "write") { failed = true; await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "Upload attachment", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Operation failed");
  const recovery = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("chrona.result-upload:"))?.[1]);
  expect(recovery).toContain("uploadId"); expect(recovery!.length).toBeLessThan(1200);
  page.once("dialog", (dialog) => dialog.accept()); await page.reload();
  await compose(page, "Recovered upload");
  await page.getByRole("button", { name: "Restore saved upload", exact: true }).click();
  await expect(page.getByRole("region", { name: "Upload attachment" }).getByRole("status")).toContainText("32768/40000");
  await page.getByLabel("Choose file").setInputFiles(file);
  await page.getByRole("button", { name: "Resume / retry upload", exact: true }).click();
  await page.getByRole("button", { name: "Attach finalized file to draft" }).click();
  await expect(page.getByRole("button", { name: "Publish version", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Publish version", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recovered upload", exact: true })).toBeVisible();
  await noOverflow(page);
});

test("shows loading, retryable read failure and read-only controls without losing saved results", async ({ page, request }, info) => {
  const taskId = await createTask(request, `read-states-${info.project.name}`);
  const seeded = await request.post("/api/results/submit", { data: { taskId, requestId: crypto.randomUUID(), expectedRevision: null,
    content: { schemaVersion: 1, outcome: { title: "Saved result", summary: "Still readable" }, readiness: { status: "partial", summary: "More work needed" } } } });
  expect(seeded.ok()).toBeTruthy();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let unavailable = true;
  await page.route("**/api/results/context", async (route) => {
    if (unavailable) { await gate; await route.abort("failed"); return; }
    const response = await route.fetch(), body = await response.json();
    await route.fulfill({ response, json: { ...body, writesEnabled: false, canSubmit: false, canReview: false, canUpload: false } });
  });
  await page.goto(`/en/tasks/${taskId}/results`);
  await expect(page.getByText("Loading results…", { exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("alert")).toContainText("Operation failed");
  unavailable = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("New result writes are disabled by the server. Existing results remain readable.").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved result", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish a new version", exact: true })).toBeDisabled();
  await noOverflow(page);
});

test("keeps a conflicting draft and retries lost responses with the original request identity", async ({ page, request }, info) => {
  const taskId = await createTask(request, `conflict-${info.project.name}`);
  await page.goto(`/en/tasks/${taskId}/results`);
  await compose(page, "My draft");
  const content = { schemaVersion: 1, outcome: { title: "Concurrent version", summary: "External change" }, readiness: { status: "ready", summary: "Ready" } };
  const external = await request.post("/api/results/submit", { data: { taskId, requestId: crypto.randomUUID(), expectedRevision: null, content } }); expect(external.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Publish version", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The result changed");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Concurrent version", exact: true })).toBeVisible();
  await expect(page.getByLabel("Result title", { exact: true })).toHaveValue("My draft");
  await page.getByRole("button", { name: "I compared latest; keep this draft" }).click();
  let lost = false; const ids: string[] = [];
  await page.route("**/api/results/submit", async (route) => {
    ids.push(route.request().postDataJSON().requestId);
    if (!lost) { lost = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
  });
  await page.getByRole("button", { name: "Publish version", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry identical request", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry identical request", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My draft", exact: true })).toBeVisible();
  expect(ids.length).toBe(2); expect(ids[0]).toBe(ids[1]);
  expect((await read(request, taskId)).version.version).toBe(2);
  await noOverflow(page);
});
