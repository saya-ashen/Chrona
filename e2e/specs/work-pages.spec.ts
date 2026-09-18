import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { exampleWorkPage } from "../../packages/ui-protocol/src/work-pages/example";
async function noOverflow(page: Page) { await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth)).toBe(true); }
async function create(request: APIRequestContext, title: string) {
  const response = await request.post("/api/work-records/capture", { data: { title, requestId: crypto.randomUUID(), context: { kind: "general" } } });
  expect(response.ok()).toBeTruthy(); return (await response.json()).receipt.taskId as string;
}
async function publish(request: APIRequestContext, taskId: string, revision: string | null = null) {
  const response = await request.post("/api/results/submit", { data: { taskId, requestId: crypto.randomUUID(), expectedRevision: revision,
    content: { schemaVersion: 1, outcome: { title: "Computer plan", summary: "The parts and buying options are ready. Discuss timing with your family." }, readiness: { status: "partial", summary: "Decision pending" }, page: exampleWorkPage }, source: { label: "Demo author · fictional prices" } } });
  expect(response.ok()).toBeTruthy(); return (await response.json()).receipt;
}
async function inputRead(request: APIRequestContext, taskId: string, view = "current") {
  const response = await request.post("/api/results/page/read", { data: { taskId, view } }); expect(response.ok()).toBeTruthy(); return response.json();
}
test("a page supports composition, durable owner answers, independent reads and version updates without erasing notes", async ({ page, request }, info) => {
  const taskId = await create(request, `Computer ${info.project.name}`), first = await publish(request, taskId);
  await page.goto(`/en/tasks/${taskId}`);
  await expect(page.getByRole("heading", { name: `Computer ${info.project.name}`, exact: true })).toBeVisible();
  await expect(page.getByText("9,260元", { exact: true })).toBeVisible();
  await page.getByLabel("Filter table…").fill("显卡"); await expect(page.getByRole("cell", { name: "示例 GPU", exact: true })).toBeVisible(); await expect(page.getByRole("cell", { name: "示例 CPU", exact: true })).toHaveCount(0); await page.getByLabel("Filter table…").fill("");
  await page.getByText("怎么买更合适", { exact: false }).first().click(); await expect(page.getByText("分两家购买", { exact: true })).toBeVisible();
  await page.getByLabel("你倾向于？").click(); await page.getByRole("option", { name: "再等等", exact: true }).click();
  await page.getByLabel("什么时候再看看？").fill("2026-10-01"); await page.getByLabel("调整后的预算").fill("9000");
  await page.getByLabel("还有什么想法？").fill("Discuss after dinner"); await page.getByRole("button", { name: "Save answers", exact: true }).click(); await expect(page.getByText("Saved to Chrona", { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.getByRole("textbox", { name: "My notes", exact: true }).fill("Keep my notes when the Agent revises the page");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  // Another editor used the aggregate in the meantime: compare, never silently adopt its revision.
  if (await page.getByRole("button", { name: "Reload latest (keep draft)", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Reload latest (keep draft)", exact: true }).click(); await page.getByRole("button", { name: "Compared; keep my draft", exact: true }).click(); await page.getByRole("button", { name: "Save note", exact: true }).click();
  }
  await expect(page.getByText("Keep my notes when the Agent revises the page", { exact: true }).first()).toBeVisible();
  await page.reload(); await expect(page.getByLabel("还有什么想法？")).toHaveValue("Discuss after dinner"); await expect(page.getByRole("combobox", { name: "你倾向于？" })).toContainText("再等等");
  const independent = await inputRead(request, taskId); expect(independent.entries.find((e: { kind: string }) => e.kind === "response").content.answers.budget).toBe(9000);
  await page.screenshot({ path: info.outputPath("work-page.png"), fullPage: true });
  await page.locator("form").screenshot({ path: info.outputPath("saved-form.png") });
  await noOverflow(page);
  await publish(request, taskId, first.editRevision); await page.reload();
  await expect(page.getByLabel("还有什么想法？")).toHaveValue(""); await expect(page.getByText("Keep my notes when the Agent revises the page", { exact: true })).toBeVisible();
  const history = await inputRead(request, taskId, "history"); expect(history.entries.some((e: { versionId: string }) => e.versionId === first.versionId)).toBe(true);
  await page.getByText("Notes and answer history", { exact: true }).click(); await expect(page.getByText("Discuss after dinner", { exact: true })).toBeVisible();
  await noOverflow(page);
  const result = await (await request.post("/api/results/read", { data: { taskId } })).json(); expect(result.result.acceptedVersionId).toBeNull();
});

test("a new page is immediately writable, guards drafts and keeps calendar and advanced tools reachable", async ({ page }, info) => {
  await page.goto("/en/home"); await page.getByRole("button", { name: "New content", exact: true }).last().click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("What are you working on?").fill(`Simple page ${info.project.name}`); await dialog.getByRole("button", { name: "Create content", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Simple page ${info.project.name}`, exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "My notes", exact: true }).fill("My first thought");
  await page.getByRole("link", { name: "View calendar", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("You have unsaved changes"); await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "My notes", exact: true })).toHaveValue("My first thought");
  await page.getByRole("button", { name: "Save note", exact: true }).click(); await expect(page.getByText("Saved to Chrona", { exact: true })).toBeVisible(); await page.reload(); await expect(page.getByText("My first thought", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More", exact: true }).click(); await expect(page.getByRole("menuitem", { name: "Results, versions and review", exact: true })).toBeVisible(); await expect(page.getByRole("menuitem", { name: "Execution and task settings", exact: true })).toBeVisible(); await page.keyboard.press("Escape");
  await noOverflow(page); await page.getByRole("link", { name: "View calendar", exact: true }).click(); await expect(page).toHaveURL(/\/schedule\?/);
});

test("lost response retries the identical request; invalid pages and read errors do not destroy drafts", async ({ page, request }, info) => {
  const taskId = await create(request, `Recovery ${info.project.name}`); await publish(request, taskId);
  await page.goto(`/en/tasks/${taskId}`); await page.getByRole("textbox", { name: "My notes", exact: true }).fill("One durable note");
  const ids: string[] = []; let lost = false;
  await page.route("**/api/results/page/input", async (route) => { ids.push(route.request().postDataJSON().requestId); if (!lost) { lost = true; await route.fetch(); await route.abort("failed"); } else await route.continue(); });
  await page.getByRole("button", { name: "Save note", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("save outcome is unknown"); await page.getByRole("button", { name: "Retry original request", exact: true }).click(); await expect(page.getByText("Saved to Chrona", { exact: true })).toBeVisible(); expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]); expect((await inputRead(request, taskId, "history")).total).toBe(1);
  const malicious = structuredClone(exampleWorkPage) as unknown as { elements: Record<string, { props: Record<string, unknown> }> };
  malicious.elements.summary.props.text = { $state: "/secret" };
  const validation = await request.post("/api/results/page/validate", { data: { taskId, page: malicious } }); expect((await validation.json()).valid).toBe(false);
  await page.route("**/api/results/read", (route) => route.abort("failed")); await page.reload(); await expect(page.getByRole("alert").first()).toContainText("Could not load this page"); await expect(page.getByText("One durable note", { exact: true })).toBeVisible(); await noOverflow(page);
});
