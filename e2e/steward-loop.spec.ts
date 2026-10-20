import { expect, test, type Page } from "@playwright/test";
import zh from "../packages/i18n/src/messages/zh.json" with { type: "json" };

test("question → workspace plan → checkbox → edit/history/revert → settings", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("chrona.accessKey", "steward-e2e-owner"));
  await page.goto("/zh");
  const composer = page.getByRole("textbox", { name: zh.steward.foundation.composer });
  await composer.fill("你好");
  await composer.press("Enter");
  await expect(page.getByText("收到", { exact: true })).toBeVisible();
  await expect(composer).toBeEnabled();
  await composer.fill("帮我做十天学习规划");
  await composer.press("Enter");
  await expect(page.getByText("已建好规划", { exact: true })).toBeVisible();
  await expect(page.getByText("今天的练习已经准备好", { exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: zh.steward.shell.navigation });
  await navigation.getByRole("link", { name: "事务", exact: true }).click();
  // Today also links the affair (progress and upcoming); wait for the list page itself.
  await expect(page.getByRole("heading", { level: 1, name: "事务", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "十天学习规划", exact: true }).click();
  await expect(page.getByText("今天从第一天练习开始", { exact: true })).toBeVisible();
  const task = page.getByRole("checkbox", { name: "完成第一天练习" });
  await expect(task).toBeVisible();
  const taskBox = await task.boundingBox();
  expect(taskBox).not.toBeNull();
  expect(taskBox!.y + taskBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("entry-with-allocation.png"), fullPage: true });
  await task.check();
  await expect(task).toBeEnabled();
  await page.reload();
  await expect(task).toBeChecked();
  const said = page.waitForResponse(response => response.url().includes("/api/steward/chat?") && response.request().postDataJSON()?.text === "今天做完了");
  await page.getByRole("button", { name: "今天做完了", exact: true }).click();
  expect((await said).ok()).toBe(true);
  await page.getByRole("link", { name: /学习规划/ }).click();
  await expect(page.getByRole("heading", { name: "学习规划", exact: true })).toBeVisible();
  await page.getByRole("link", { name: zh.steward.affairCenter.backHome, exact: true }).click();
  await expect(task).toBeChecked();
  await page.getByRole("link", { name: /学习规划/ }).click();
  await expect(page.getByRole("heading", { name: "学习规划", exact: true })).toBeVisible();
  await expect(page.getByText("每天学习，逐步完成。", { exact: true })).toBeVisible();
  await expect(page.getByText("每天学习，逐步完成。", { exact: true })).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("secondary-reader.png"), fullPage: true });
  await page.getByText(zh.steward.affairCenter.secondLevel, { exact: true }).click();
  const pages = page.getByRole("navigation", { name: zh.steward.affairFile.pages });
  // Narrow screens keep the page list collapsed above the content.
  const pageList = pages.locator("summary");
  if (await pageList.isVisible()) await pageList.click();
  await expect(pages.getByRole("link", { name: "day-1", exact: true }).filter({ visible: true })).toBeVisible();
  const arrangements = page.getByRole("region", { name: zh.steward.affairCenter.schedules, exact: true });
  await expect(arrangements.getByText("每日学习提醒", { exact: true })).toBeVisible();
  await expect(arrangements.getByText(/^每天 08:00 · /)).toBeVisible();
  const checkbox = page.getByRole("checkbox", { name: "阅读学习目标" });
  await checkbox.check();
  await expect(checkbox).toBeEnabled();
  await page.reload();
  await expect(checkbox).toBeChecked();
  await page.getByRole("button", { name: zh.steward.affairFile.edit, exact: true }).click();
  const editor = page.getByRole("textbox", { name: zh.steward.affairFile.editor });
  await editor.fill(`${await editor.inputValue()}\n用户补充的学习笔记\n`);
  await page.getByRole("button", { name: zh.steward.affairFile.save, exact: true }).click();
  await expect(page.getByText("用户补充的学习笔记", { exact: true })).toBeVisible();
  await page.reload();
  // Revision history stays behind the secondary workspace and its technical details.
  await page.getByText(zh.steward.affairCenter.secondLevel, { exact: true }).click();
  await page.locator("summary").filter({ hasText: zh.steward.affairCenter.technicalCount.split("：")[0] }).click();
  await page.locator("summary").filter({ hasText: zh.steward.affairCenter.history }).click();
  const history = page.getByRole("region", { name: zh.steward.history.title });
  const revision = history.getByRole("button", { name: /· 你 ·/ }).first();
  await expect(revision).toBeVisible();
  await revision.click();
  await expect(history.getByLabel(zh.steward.history.diff)).toContainText("+用户补充的学习笔记");
  await history.getByRole("button", { name: zh.steward.history.revert, exact: true }).click();
  await expect(history.getByText(zh.steward.history.confirm, { exact: true })).toBeVisible();
  await history.getByRole("button", { name: zh.steward.history.revert, exact: true }).click();
  await expect(history.getByText(zh.steward.history.confirm, { exact: true })).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "README.md", exact: true })).not.toContainText("用户补充的学习笔记");
  await expect(checkbox).toBeChecked();
  await navigation.getByRole("link", { name: "设置", exact: true }).click();
  await page.locator("summary").filter({ hasText: zh.steward.settings.addEmail }).click();
  await expect(page.getByRole("textbox", { name: zh.steward.settings.imapHost, exact: true })).toBeVisible();
  await expect(page.getByLabel(zh.steward.settings.password, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function ownerAffair(page: Page, title: string) {
  await page.addInitScript(() => localStorage.setItem("chrona.accessKey", "steward-e2e-owner"));
  const discovery = page.waitForResponse(response => response.url().includes("/api/steward/today?"));
  await page.goto("/zh");
  const origin = new URL((await discovery).url()).origin;
  const headers = { authorization: "Bearer steward-e2e-owner" };
  const created = await page.request.post(`${origin}/api/steward/affairs?workspaceId=ws_default`, { headers, data: { title } });
  expect(created.ok()).toBe(true);
  const affair = await created.json() as { id: string };
  return { origin, headers, affair };
}

test("Provider questions roundtrip, disappear after completion, and do not create grants", async ({ page }) => {
  const { origin, headers, affair } = await ownerAffair(page, "独立交互演示");
  await page.goto(`/zh/affairs/${affair.id}`);
  const composer = page.getByRole("textbox", { name: zh.steward.affairCenter.supplement, exact: true });
  await composer.fill("交互验收"); await composer.press("Enter");
  const inbox = page.getByRole("region", { name: zh.steward.providerWork.needsInput, exact: true });
  const region = page.getByRole("region", { name: zh.steward.providerWork.title, exact: true });
  await expect(inbox.getByText("演示请求 confirm", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(inbox.getByText(zh.steward.providerWork.boundary)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("provider-question.png"), fullPage: true });
  await inbox.getByRole("button", { name: zh.steward.providerWork.deny, exact: true }).click();
  await expect(inbox.getByText("演示请求 select", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(inbox.getByRole("button", { name: zh.steward.providerWork.send, exact: true })).toBeDisabled();
  await inbox.getByRole("button", { name: "选项乙", exact: true }).click();
  await inbox.getByRole("button", { name: zh.steward.providerWork.send, exact: true }).click();
  await expect(inbox.getByText("演示请求 input", { exact: true })).toBeVisible({ timeout: 15_000 });
  await inbox.getByRole("textbox", { name: zh.steward.providerWork.answer }).fill("演示答复，不含凭据");
  await inbox.getByRole("button", { name: zh.steward.providerWork.send, exact: true }).click();
  await expect(inbox.getByText("演示请求 editor", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(inbox.getByRole("textbox", { name: zh.steward.providerWork.answer })).toHaveValue("演示原文\n请修改后交回");
  await inbox.getByRole("textbox", { name: zh.steward.providerWork.answer }).fill("演示多行答复\n第二行");
  await inbox.getByRole("button", { name: zh.steward.providerWork.send, exact: true }).click();
  await expect(page.getByRole("region", { name: zh.steward.foundation.reply, exact: true }).getByText("四项演示答复已收到，未执行外部动作", { exact: true })).toBeVisible();
  await expect(inbox.getByRole("button", { name: zh.steward.providerWork.allow, exact: true })).toHaveCount(0);
  await region.getByText(zh.steward.providerWork.details, { exact: true }).click();
  await expect(region.getByText(zh.steward.providerWork.estimate, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("provider-answered.png"), fullPage: true });
  const grants = await page.request.get(`${origin}/api/steward/grants?workspaceId=ws_default`, { headers });
  expect(grants.ok()).toBe(true); expect((await grants.json() as { items: unknown[] }).items).toHaveLength(0);
  await expect(composer).toBeEnabled();
  await composer.fill("交互验收，随后停止"); await composer.press("Enter");
  await expect(inbox.getByRole("button", { name: zh.steward.providerWork.deny, exact: true })).toBeVisible({ timeout: 15_000 });
  await inbox.getByRole("button", { name: zh.steward.providerWork.stop, exact: true }).click();
  const confirmation = inbox.getByRole("alert").filter({ hasText: zh.steward.providerWork.stopConfirm });
  await confirmation.getByRole("button", { name: zh.steward.providerWork.stop, exact: true }).click();
  await expect(inbox.getByRole("button", { name: zh.steward.providerWork.deny, exact: true })).toHaveCount(0);
  const stopped = await page.request.get(`${origin}/api/steward/provider/runs?workspaceId=ws_default&affairId=${affair.id}`, { headers });
  const items = (await stopped.json() as { items: { status: string }[] }).items;
  expect(items[0]?.status).toBe("cancelled"); expect(items.some(item => item.status === "queued")).toBe(false);
  await page.screenshot({ path: test.info().outputPath("provider-cancelled.png"), fullPage: true });
});

test("protected attachments: authenticated image/audio, relative navigation and download", async ({ page }) => {
  const { origin, headers, affair } = await ownerAffair(page, "附件验收");
  const base = `${origin}/api/steward/affairs/${affair.id}`;
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
    const context = canvas.getContext("2d")!; context.fillStyle = "#7967aa"; context.fillRect(0, 0, 2, 2);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const wav = Buffer.alloc(44 + 3200);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(3200, 40);
  for (const [name, mimeType, buffer, dir] of [
    ["photo.png", "image/png", Buffer.from(png, "base64"), "media"],
    ["voice.wav", "audio/wav", wav, "media"], ["report.bin", "application/octet-stream", Buffer.from("synthetic-result"), ""],
    ["day.md", "text/markdown", Buffer.from("# Relative material\n\nFixture only."), "days"],
  ] as const) {
    const uploaded = await page.request.post(`${base}/upload?workspaceId=ws_default`, { headers, multipart: { dir, file: { name, mimeType, buffer } } });
    expect(uploaded.ok()).toBe(true);
  }
  expect((await page.request.get(`${base}/raw?workspaceId=ws_default&path=media%2Fphoto.png`)).status()).toBe(401);
  const original = await page.request.get(`${base}/file?workspaceId=ws_default&path=README.md`, { headers });
  const revision = (await original.json() as { revision: string | null }).revision;
  const saved = await page.request.put(`${base}/file?workspaceId=ws_default`, { headers, data: { path: "README.md", baseRevision: revision, content: "# Materials\n\nSynthetic attachment test.\n\n## Files\n[Listen](media/voice.wav)\n\n[Binary](report.bin)\n\n[Day material](days/day.md)\n\n![Fixture photo](media/photo.png)\n" } });
  expect(saved.ok()).toBe(true);
  await page.goto(`/zh/affairs/${affair.id}`);
  const image = page.getByRole("img", { name: "Fixture photo", exact: true });
  await expect(image).toBeVisible(); await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(2);
  expect(await image.getAttribute("src")).toMatch(/^blob:/);
  await page.getByRole("link", { name: "Day material", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Relative material", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("path")).toBe("days/day.md");
  await page.getByRole("link", { name: zh.steward.affairCenter.backHome, exact: true }).click();
  await page.getByRole("link", { name: "Listen", exact: true }).click();
  const audio = page.locator('audio[aria-label="media/voice.wav"]');
  await expect(audio).toBeVisible(); await expect.poll(() => audio.evaluate(element => (element as HTMLMediaElement).readyState)).toBeGreaterThanOrEqual(1);
  expect(await audio.getAttribute("src")).toMatch(/^blob:/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("authenticated-audio.png"), fullPage: true });
  await page.getByRole("link", { name: zh.steward.affairCenter.backHome, exact: true }).click();
  await page.getByRole("link", { name: "Binary", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: `${zh.steward.affairFile.download}: report.bin`, exact: true }).click();
  const download = await downloading; expect(download.suggestedFilename()).toBe("report.bin");
  const stream = await download.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("synthetic-result");
});
