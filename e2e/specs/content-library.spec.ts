import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
async function read(request: APIRequestContext, data: object = {}) { const r = await request.post("/api/library/read", { data }); expect(r.ok()).toBeTruthy(); return r.json(); }
async function command(request: APIRequestContext, action: object) {
  const view = await read(request, { view: "catalog" });
  const r = await request.post("/api/library/update", { data: { requestId: crypto.randomUUID(), expectedRevision: view.revision, action } }); expect(r.ok()).toBeTruthy(); return (await r.json()).receipt;
}
async function task(request: APIRequestContext, title: string) {
  const r = await request.post("/api/work-records/capture", { data: { title, requestId: crypto.randomUUID(), context: { kind: "general" } } }); expect(r.ok()).toBeTruthy(); return (await r.json()).receipt.taskId as string;
}
async function noOverflow(page: Page) { await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth)).toBe(true); }

test("header creation uses the selected folder; classification conflicts retain the created content without duplication", async ({ page, request }, info) => {
  const name = `Header ${info.project.name}`;
  const g = await command(request, { type: "group_create", name }), groupId = g.changes[0].groupId;
  const f = await command(request, { type: "folder_create", groupId, name: "Drafts" }), folderId = f.changes[0].folderId;
  const path = `/en/home?group=${groupId}&folder=${folderId}`;
  const main = page.locator("main.chrona-app-main");
  for (const conflict of [false, true]) {
    const title = `${name} content ${conflict ? "conflicted" : "placed"}`;
    await page.goto(path);
    await page.getByRole("banner").getByRole("button", { name: "New content", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("What are you working on?").fill(title);
    if (conflict) await command(request, { type: "group_update", groupId, name, instructions: "Concurrent change", allowAgentFolders: true });
    await dialog.getByRole("button", { name: "Create content", exact: true }).click();
    if (conflict) {
      await expect(dialog.getByText("Content was created, but its classification has not been saved.", { exact: false })).toBeVisible();
      await expect(dialog.getByRole("alert")).toContainText("library changed");
      await dialog.getByRole("button", { name: "Open content", exact: true }).click();
    }
    await expect(main.getByRole("heading", { name: title, exact: true })).toBeVisible();
    const matches = await read(request, { query: title });
    expect(matches.total).toBe(1);
    expect(matches.items[0].placements).toHaveLength(conflict ? 0 : 1);
    if (!conflict) expect(matches.items[0].placements[0].folderId).toBe(folderId);
    await noOverflow(page);
  }
});

test("create classification rules and folders, file one content in two groups, browse both and preserve content after deletion", async ({ page, request }, info) => {
  const name = `Topic ${info.project.name}`, title = `Computer ${info.project.name}`;
  const taskId = await task(request, title);
  await page.goto("/en/home"); const main = page.locator("main.chrona-app-main");
  await expect(main.getByRole("heading", { name: "All content", exact: true })).toBeVisible();
  await main.getByRole("button", { name: "New classification group", exact: true }).click();
  let dialog = page.getByRole("dialog"); await dialog.getByLabel("Name", { exact: true }).fill(name); await dialog.getByLabel("Classification rules", { exact: true }).fill("Choose by topic; do not infer who owns a computer."); await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0); await main.getByRole("link", { name, exact: false }).click();
  await expect(main.getByRole("heading", { name, exact: true })).toBeVisible();
  await main.getByRole("button", { name: "New folder", exact: true }).click(); dialog = page.getByRole("dialog"); await dialog.getByLabel("Name", { exact: true }).fill("Computers"); await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect(dialog).toHaveCount(0);
  await main.getByRole("button", { name: `Manage ${title}`, exact: true }).click(); await page.getByRole("menuitem", { name: "Organize", exact: true }).click();
  dialog = page.getByRole("dialog"); await dialog.getByRole("combobox", { name: "Choose a classification group", exact: true }).click(); await page.getByRole("option", { name, exact: true }).click(); await expect(dialog.getByRole("combobox", { name: "Folders", exact: true })).toBeEnabled();
  await dialog.getByRole("combobox", { name: "Folders", exact: true }).click(); await page.getByRole("option", { name: "Computers", exact: true }).click(); await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect(dialog).toHaveCount(0);
  const catalog = await read(request, { view: "catalog" }), group = catalog.groups.find((g: { name: string }) => g.name === name);
  const owner = await command(request, { type: "group_create", name: `Ownership ${info.project.name}` }), otherId = owner.changes[0].groupId;
  await command(request, { type: "assign", taskId, placements: [{ groupId: otherId, destination: { type: "create", name: "Family" } }] });
  await page.reload(); await main.getByRole("link", { name: "Computers 1", exact: true }).click(); await expect(main.getByRole("link", { name: new RegExp(title) })).toHaveCount(1);
  await expect(main.getByText("Total content：1", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("library-folder.png"), fullPage: true }); await noOverflow(page);
  const item = (await read(request, { view: "item", taskId })).items[0]; expect(item.placements).toHaveLength(2);
  const family = item.placements.find((p: { groupId: string }) => p.groupId === otherId);
  await page.goto(`/en/home?group=${otherId}&folder=${family.folderId}`); await expect(main.getByRole("link", { name: new RegExp(title) })).toHaveCount(1); await main.getByRole("link", { name: new RegExp(title) }).click(); await expect(main.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "View calendar", exact: true })).toBeVisible(); await expect(main.getByRole("button", { name: "More", exact: true })).toBeVisible();
  await page.goto(`/en/home?group=${group.id}`); await main.getByRole("button", { name: "Edit folder Computers", exact: true }).click();
  page.once("dialog", d=>d.accept()); await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(main.getByRole("link", { name: new RegExp(title) })).toHaveCount(1);
  const kept = (await read(request, { view: "item", taskId })).items[0]; expect(kept.placements.find((p: { groupId: string })=>p.groupId===group.id).folderId).toBeNull(); expect(kept.placements.find((p: { groupId: string })=>p.groupId===otherId).folderId).toBe(family.folderId);
  await noOverflow(page);
});

test("lost organization response retries exactly; concurrent edits require comparison and preserve drafts", async ({ page, request }, info) => {
  const g = await command(request, { type: "group_create", name: `Recovery ${info.project.name}` }), groupId = g.changes[0].groupId;
  await page.goto(`/en/home?group=${groupId}`); const main = page.locator("main.chrona-app-main"); await main.getByRole("button", { name: "New folder", exact: true }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("Name", { exact: true }).fill("Recovered folder");
  const ids: string[] = []; let lost = false;
  await page.route("**/api/library/update", async route => { ids.push(route.request().postDataJSON().requestId); if (!lost) { lost = true; await route.fetch(); await route.abort("failed"); } else await route.continue(); });
  await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("Saving has not been confirmed"); await dialog.getByRole("button", { name: "Retry original request", exact: true }).click(); await expect(dialog).toHaveCount(0); expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  expect((await read(request, { view: "catalog", groupId })).folders).toHaveLength(1);
  await page.unroute("**/api/library/update"); await main.getByRole("button", { name: "Manage classification group", exact: true }).click(); await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await dialog.getByLabel("Classification rules", { exact: true }).fill("My retained draft");
  await command(request, { type: "group_update", groupId, name: `Recovery ${info.project.name}`, instructions: "Newer saved rules", allowAgentFolders: false });
  await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect(dialog.getByRole("alert")).toContainText("library changed"); await expect(dialog.getByLabel("Classification rules", { exact: true })).toHaveValue("My retained draft");
  await dialog.getByRole("button", { name: "Reload and compare", exact: true }).click(); await dialog.getByText("View currently saved values", { exact: true }).click(); await expect(dialog.getByText("Newer saved rules", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect(dialog).toHaveCount(0); expect((await read(request, { view: "catalog", groupId })).groups.find((v: { id: string })=>v.id===groupId).instructions).toBe("My retained draft");
  await main.getByText("Organization history", { exact: true }).click(); await expect(main.getByText("Created folder：Recovery", { exact: false })).toBeVisible(); await noOverflow(page);
});

test("directory search/pagination is complete; new content goes into the selected folder; loading and error recovery remain usable", async ({ page, request }, info) => {
  const g = await command(request, { type: "group_create", name: `Browse ${info.project.name}` }), groupId = g.changes[0].groupId;
  const f = await command(request, { type: "folder_create", groupId, name: "Inbox" }), folderId = f.changes[0].folderId;
  await page.goto(`/en/home?group=${groupId}&folder=${folderId}`); const main = page.locator("main.chrona-app-main");
  await main.getByRole("button", { name: "New content", exact: true }).click(); const dialog = page.getByRole("dialog"); const title = `Folder draft ${info.project.name}`;
  await dialog.getByLabel("What are you working on?").fill(title); await dialog.getByRole("button", { name: "Create content", exact: true }).click(); await expect(main.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const item = (await read(request, { groupId, folderId })).items.find((v: { title: string })=>v.title===title); expect(item.placements[0].folderId).toBe(folderId);
  for(let i=0;i<22;i++) await task(request, `Searchable ${info.project.name} ${String(i).padStart(2,"0")}`);
  await page.goto(`/en/home?q=${encodeURIComponent(`Searchable ${info.project.name}`)}`); await expect(main.getByRole("link", { name: /Searchable/ })).toHaveCount(20); await expect(main.getByText("Current results · 22")).toBeVisible(); await main.getByRole("button", { name: "Next", exact: true }).click(); await expect(main.getByRole("link", { name: /Searchable/ })).toHaveCount(2); await page.reload(); await expect(main.getByRole("link", { name: /Searchable/ })).toHaveCount(2);
  await page.route("**/api/library/read", route=>route.abort("failed")); await page.reload(); await expect(main.getByRole("alert")).toContainText("could not be loaded"); await page.unroute("**/api/library/read"); await main.getByRole("button", { name: "Reload", exact: true }).click(); await expect(main.getByRole("link", { name: /Searchable/ })).toHaveCount(2); await noOverflow(page);
});
