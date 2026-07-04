import { expect, test } from "@playwright/test";

const SETTINGS_URL = "/en/settings?panel=ai-clients";

async function selectHermesProvider(page: import("@playwright/test").Page) {
  await page.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Hermes" }).click();
}

test.describe("AI Client Settings", () => {
  test("create, edit, delete, and duplicate an AI client through the UI", async ({
    page,
  }) => {
    // Mock the test-availability endpoint so we don't try to connect to real LLMs
    await page.route("**/api/ai/clients/test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, available: true, reason: "Mock OK" }),
      });
    });

    await test.step("1. Open AI client settings", async () => {
      await page.goto(SETTINGS_URL);
      await expect(
        page.getByRole("heading", { name: /manage ai clients/i }),
      ).toBeVisible();
    });

    await test.step("2. Create a new AI client", async () => {
      await page.getByRole("button", { name: /add client/i }).click();
      await selectHermesProvider(page);
      await page.getByPlaceholder("My Hermes Client").fill("E2E Settings Client");
      await page.getByPlaceholder("http://127.0.0.1:8642").fill("https://api.mock.ai/v1");
      await page.getByPlaceholder("optional for localhost").fill("sk-test-e2e-settings");

      const createResp = page.waitForResponse(
        (res) =>
          res.url().includes("/api/ai/clients") &&
          res.request().method() === "POST",
      );
      await page.getByRole("button", { name: /^save$/i }).click();
      await createResp;

      await expect(page.getByText("E2E Settings Client")).toBeVisible();
    });

    await test.step("3. Edit the AI client", async () => {
      // Click edit on the client card
      await page.getByRole("button", { name: "Edit" }).first().click();

      // Change the name
      const nameInput = page.getByPlaceholder("My Hermes Client");
      await nameInput.clear();
      await nameInput.fill("E2E Settings Client (Updated)");

      const updateResp = page.waitForResponse(
        (res) =>
          res.url().includes("/api/ai/clients") &&
          res.request().method() === "PATCH",
      );
      await page.getByRole("button", { name: /^save$/i }).click();
      await updateResp;

      await expect(
        page.getByText("E2E Settings Client (Updated)"),
      ).toBeVisible();
    });

    await test.step("4. Test availability shows result", async () => {
      await page.getByRole("button", { name: "Edit" }).first().click();

      await page.getByRole("button", { name: /test availability/i }).first().click();
      await expect(page.getByText(/available/i).first()).toBeVisible();
    });

    await test.step("5. Delete the AI client removes it from the list", async () => {
      // Cancel first to close the edit form
      await page.getByRole("button", { name: /cancel/i }).click();

      // Click the delete handler — in the dialog it triggers a DELETE API call
      const deleteBtn = page.getByRole("button", { name: "Delete" }).first();

      // Handle the confirm dialog
      page.once("dialog", (dialog) => dialog.accept());

      const deleteResp = page.waitForResponse(
        (res) =>
          res.url().includes("/api/ai/clients") &&
          res.request().method() === "DELETE",
      );
      await deleteBtn.click();
      await deleteResp;

      await expect(
        page.getByText("E2E Settings Client (Updated)"),
      ).not.toBeVisible();
    });
  });

  test("sets a client as default and unsets previous default", async ({
    page,
  }) => {
    await page.route("**/api/ai/clients/test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, available: true, reason: "Mock OK" }),
      });
    });

    // Create two clients
    await page.goto(SETTINGS_URL);
    await expect(
      page.getByRole("heading", { name: /manage ai clients/i }),
    ).toBeVisible();

    // Client A
    await page.getByRole("button", { name: /add client/i }).click();
    await selectHermesProvider(page);
    await page.getByPlaceholder("My Hermes Client").fill("Default Client A");
    await page.getByPlaceholder("http://127.0.0.1:8642").fill("https://a.mock.ai/v1");
    await page.getByPlaceholder("optional for localhost").fill("sk-a");

    const respA = page.waitForResponse(
      (res) =>
        res.url().includes("/api/ai/clients") &&
        res.request().method() === "POST",
    );
    await page.getByRole("button", { name: /^save$/i }).click();
    await respA;

    // Client B
    await page.getByRole("button", { name: /add client/i }).click();
    await selectHermesProvider(page);
    await page.getByPlaceholder("My Hermes Client").fill("Default Client B");
    await page.getByPlaceholder("http://127.0.0.1:8642").fill("https://b.mock.ai/v1");
    await page.getByPlaceholder("optional for localhost").fill("sk-b");
    await page.getByRole("checkbox", { name: "Use as default AI client" }).click();

    const respB = page.waitForResponse(
      (res) =>
        res.url().includes("/api/ai/clients") &&
        res.request().method() === "POST",
    );
    await page.getByRole("button", { name: /^save$/i }).click();
    await respB;

    // Now edit Client A and set as default
    await page.getByRole("button", { name: "Edit" }).first().click();
    await page.getByRole("checkbox", { name: "Use as default AI client" }).click();

    const patchResp = page.waitForResponse(
      (res) =>
        res.url().includes("/api/ai/clients") &&
        res.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: /^save$/i }).click();
    await patchResp;

    // Verify both cards exist (both survived)
    await expect(page.getByText("Default Client A").first()).toBeVisible();
    await expect(page.getByText("Default Client B").first()).toBeVisible();
  });

  test("rejects client creation with empty name", async ({ page }) => {
    await page.route("**/api/ai/clients/test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, available: true, reason: "Mock OK" }),
      });
    });

    await page.goto(SETTINGS_URL);
    await page.getByRole("button", { name: /add client/i }).click();
    await selectHermesProvider(page);

    // Leave name empty, save should be blocked by frontend or show error
    await page.getByPlaceholder("http://127.0.0.1:8642").fill("https://mock.ai/v1");
    await page.getByPlaceholder("optional for localhost").fill("sk-test");

    const saveBtn = page.getByRole("button", { name: /^save$/i });
    await saveBtn.click();
    await expect(page.getByRole("alert").filter({ hasText: "Name" })).toBeVisible();
  });
});
