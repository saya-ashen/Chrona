import { expect, test, type APIRequestContext } from "@playwright/test";
import { expectContentLayout as noOverflow } from "../helpers/content-layout";
import { exampleWorkPage } from "../../packages/ui-protocol/src/work-pages/example";
async function create(request: APIRequestContext, title: string, description?: string) {
  const response = await request.post("/api/work-records/capture", { data: { title, description, requestId: crypto.randomUUID(), context: { kind: "general" } } });
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
test("existing task descriptions survive content-first navigation without fabricating results", async ({ page, request }, info) => {
  const description = `Current: draft saved\nNext: confirm documents\nDeadline: 2026-12-01\n${"long-reference-".repeat(40)}\n<img src=x onerror=alert(1)>`;
  const title = `Existing context ${info.project.name}`;
  const taskId = await create(request, title, description);
  await page.goto("/en/home");
  await page.getByRole("textbox", { name: "Search all content…", exact: true }).fill(title);
  await page.locator(`a[href="/en/tasks/${taskId}"]`).click();
  const context = page.getByRole("region", { name: "Task description", exact: true });
  await expect(context).toContainText("Next: confirm documents");
  await expect(context.locator("p")).toHaveText(description);
  await expect(context.locator("img")).toHaveCount(0);
  await expect(page.getByText("A blank page. Start with a thought.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "My notes", exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath("task-description-fallback.png"), fullPage: true });
  await page.goto(`/en/tasks/${taskId}/page`);
  await expect(context).toContainText("Deadline: 2026-12-01");
  const before = await (await request.post("/api/results/read", { data: { taskId } })).json();
  expect(before.version).toBeNull();
  await page.route("**/api/results/read", (route) => route.abort("failed"));
  await page.reload();
  await expect(page.getByRole("alert").first()).toContainText("Could not load this page");
  await expect(context).toHaveCount(0);
  await expect(page.getByText("A blank page. Start with a thought.", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/results/read");
  await publish(request, taskId, before.result?.editRevision ?? null);
  await page.reload();
  await expect(page.getByText("9,260元", { exact: true })).toBeVisible();
  await expect(context).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "My notes", exact: true })).toBeVisible();
  await noOverflow(page);
});

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
  const columns = await page.locator("form > .grid").evaluate((grid) => ({ count: getComputedStyle(grid).gridTemplateColumns.split(" ").length, width: grid.getBoundingClientRect().width }));
  expect(columns.count).toBe(columns.width >= 640 ? 2 : 1);
  await noOverflow(page);
  if (info.project.name === "chromium") {
    const original = page.viewportSize()!; await page.setViewportSize({ width: 1920, height: 1080 });
    await noOverflow(page); await expect(page.getByRole("button", { name: "Save answers", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("wide-content.png") }); await page.setViewportSize(original);
  }
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

test("saved feedback hands off to another session, reports changes and preserves later notes and old forms", async ({ page, request }, info) => {
  const taskId = await create(request, `Continuation ${info.project.name}`), first = await publish(request, taskId);
  await page.goto(`/en/tasks/${taskId}`);
  await page.getByRole("textbox", { name: "My notes", exact: true }).fill("Parents prefer quiet parts");
  await page.getByRole("button", { name: "Ask your Agent to continue", exact: true }).click();
  await page.getByRole("textbox", { name: "What should the Agent work on next?" }).fill("Adjust the budget, do not purchase");
  await expect(page.getByRole("button", { name: "Save request and prepare handoff" })).toBeDisabled();
  await expect(page.getByText("Save other note or form drafts first.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save request and prepare handoff" })).toBeEnabled();
  const ids: string[] = []; let lost = false;
  await page.route("**/api/results/page/input", async (route) => {
    if (route.request().postDataJSON().action.type !== "handoff") return route.continue();
    ids.push(route.request().postDataJSON().requestId);
    if (!lost) { lost = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
  });
  await page.getByRole("button", { name: "Save request and prepare handoff" }).click();
  await expect(page.getByRole("alert")).toContainText("save outcome is unknown");
  await page.getByRole("button", { name: "Retry original request", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Request saved — ready to share with your Agent" })).toBeVisible();
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  // Clipboard fallback keeps the exact request identity usable without leaking note contents.
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } }));
  await page.getByRole("button", { name: "Copy handoff", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Copy handoff", exact: true })).toContainText(taskId);
  const snapshot = await inputRead(request, taskId, "handoff");
  expect(snapshot.total).toBe(1); expect(snapshot.handoff.newInputCount).toBe(0);
  await page.getByRole("textbox", { name: "My notes", exact: true }).fill("Later: also keep it small");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByText("1 notes or answers changed afterwards", { exact: false })).toBeVisible();
  const current = await (await request.post("/api/results/read", { data: { taskId } })).json();
  const continuation = { requestId: snapshot.handoff.request.id, baseVersionId: first.versionId, summary: "A quieter plan within budget", changes: ["Changed the cooler and kept the purchase undecided"], feedback: [{ entryId: snapshot.entries[0].id, disposition: "incorporated", explanation: "Chose quieter cooling to match the family's request" }] };
  const updated = await request.post("/api/results/submit", { data: { taskId, requestId: crypto.randomUUID(), expectedRevision: current.result.editRevision, content: { ...current.version.content, continuation } } });
  expect(updated.ok()).toBeTruthy(); await page.reload();
  await expect(page.getByRole("heading", { name: "What changed in this update" })).toBeVisible();
  await expect(page.getByText("A quieter plan within budget", { exact: true })).toBeVisible();
  await expect(page.getByText("Later: also keep it small", { exact: true })).toBeVisible();
  await page.getByText("How feedback was handled", { exact: true }).click();
  await expect(page.getByText("Author reports incorporated", { exact: true })).toBeVisible();
  await expect(page.getByText("An update report from the page author, not your confirmation or acceptance.")).toBeVisible();
  await noOverflow(page); await page.screenshot({ path: info.outputPath("continuation-update.png"), fullPage: true });
  expect((await (await request.post("/api/results/read", { data: { taskId } })).json()).result.acceptedVersionId).toBeNull();
});

test("a handoff cannot silently bind a newer page; reconciliation preserves the draft", async ({ page, request }, info) => {
  const taskId = await create(request, `Handoff conflict ${info.project.name}`), first = await publish(request, taskId);
  await page.goto(`/en/tasks/${taskId}`);
  await page.getByRole("button", { name: "Ask your Agent to continue", exact: true }).click();
  await page.getByRole("textbox", { name: "What should the Agent work on next?" }).fill("Keep this draft");
  await publish(request, taskId, first.editRevision);
  await page.getByRole("button", { name: "Save request and prepare handoff" }).click();
  await page.getByRole("button", { name: "Reload latest (keep draft)", exact: true }).click();
  await expect(page.getByText("A newer page exists.", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "What should the Agent work on next?" })).toHaveValue("Keep this draft");
  await expect(page.getByRole("button", { name: "Compared; keep my draft", exact: true })).toHaveCount(0);
  expect((await inputRead(request, taskId, "handoff")).handoff).toBeNull(); await noOverflow(page);
});
