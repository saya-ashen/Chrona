import { test } from "@playwright/test";

test.setTimeout(90000);

test("README demo: schedule task block flow", async ({ page }) => {
  await page.route("**/api/ai/decompose-task", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        planGraph: {
          revision: 1,
          generatedBy: "demo-mock",
          summary: "Mock demo plan",
          updatedAt: new Date().toISOString(),
          changeSummary: null,
          nodes: [],
          edges: [],
        },
        savedPlan: null,
      }),
    });
  });

  await page.goto("/schedule");
  await page.waitForLoadState("networkidle");
  await page.getByRole("heading", { name: "Schedule", exact: true }).waitFor();
  await page.waitForTimeout(1200);

  await page.getByRole("button", { name: "Quick add" }).click();
  await page.waitForTimeout(900);

  await page.getByPlaceholder("Add title").fill("Prepare Chrona README demo");
  await page.waitForTimeout(700);

  await page.getByPlaceholder("Add description").fill(
    "Create an automated README demo flow that showcases planning and scheduling in Chrona.",
  );
  await page.waitForTimeout(700);

  await page.getByRole("button", { name: "High" }).click();
  await page.waitForTimeout(600);

  await page.getByRole("textbox").nth(2).fill("10:00");
  await page.waitForTimeout(300);
  await page.getByRole("textbox").nth(3).fill("11:30");
  await page.waitForTimeout(700);

  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1800);

  await page.mouse.move(1180, 220, { steps: 20 });
  await page.waitForTimeout(600);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(1400);
});
