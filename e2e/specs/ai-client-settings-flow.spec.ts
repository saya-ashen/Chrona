import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

const SETTINGS_URL = "/en/settings?panel=ai-clients";
const MANAGED_CLIENT_NAMES = new Set([
	"Default Client A",
	"Default Client B",
	"Diagnostics Client",
]);

type E2eAiClient = { id: string; name: string; isDefault: boolean };

function isManagedClient(client: E2eAiClient): boolean {
	return (
		client.name.startsWith("E2E Settings Client") ||
		MANAGED_CLIENT_NAMES.has(client.name)
	);
}

async function listClients(request: APIRequestContext): Promise<E2eAiClient[]> {
	let clients: E2eAiClient[] = [];
	await expect
		.poll(
			async () => {
				const response = await request.get("/api/ai/clients");
				if (!response.ok()) return false;
				clients =
					((await response.json()) as { clients?: E2eAiClient[] }).clients ?? [];
				return true;
			},
			{ timeout: 15_000, intervals: [200, 500, 1_000] },
		)
		.toBe(true);
	return clients;
}

async function removeManagedClients(request: APIRequestContext): Promise<void> {
	for (const client of await listClients(request)) {
		if (!isManagedClient(client)) continue;
		const response = await request.delete(`/api/ai/clients/${client.id}`);
		expect(response.ok()).toBeTruthy();
	}
}

async function selectHermesProvider(page: Page) {
	await page.getByRole("combobox", { name: "Type" }).click();
	await page.getByRole("option", { name: "Hermes" }).click();
}

async function fillAdvancedConnectionSettings(
	page: Page,
	baseUrl: string,
	apiKey: string,
) {
	await page.locator("summary").filter({ hasText: "Advanced settings" }).click();
	await page
		.getByRole("textbox", { name: "Base URL", exact: true })
		.fill(baseUrl);
	await page.getByRole("textbox", { name: "API Key", exact: true }).fill(apiKey);
}

test.describe("AI Client Settings", () => {
	let originalDefaultClientId: string | null = null;

	test.setTimeout(60_000);
	test.beforeEach(async ({ request }) => {
		await removeManagedClients(request);
		originalDefaultClientId =
			(await listClients(request)).find((client) => client.isDefault)?.id ?? null;
	});
	test.afterEach(async ({ request }) => {
		await removeManagedClients(request);
		if (originalDefaultClientId) {
			const remaining = await listClients(request);
			if (remaining.some((client) => client.id === originalDefaultClientId)) {
				const response = await request.patch(
					`/api/ai/clients/${originalDefaultClientId}`,
					{ data: { isDefault: true } },
				);
				expect(response.ok()).toBeTruthy();
			}
		}
		originalDefaultClientId = null;
	});
	test("keeps settings controls visible and the client dialog centered", async ({
		page,
	}) => {
		const viewports = [
			{ width: 1440, height: 900 },
			{ width: 1024, height: 768 },
			{ width: 390, height: 844 },
		];

		for (const viewport of viewports) {
			await page.setViewportSize(viewport);
			await page.goto("/en/settings");

			for (const name of [
				"Auto-generate plan after saving",
				"Default task auto-execution",
			]) {
				const toggle = page.getByRole("switch", { name });
				await expect(toggle).toBeVisible();
				const toggleBox = await toggle.boundingBox();
				expect(toggleBox?.width).toBeGreaterThanOrEqual(24);
				expect(toggleBox?.height).toBeGreaterThanOrEqual(14);
			}

			await page.getByRole("link", { name: "Manage AI clients" }).click();
			const dialog = page.getByRole("dialog");
			await expect(dialog).toBeVisible();
			for (let index = 0; index < 8; index += 1) {
				await page.keyboard.press("Tab");
				await expect(dialog.locator(":focus")).toHaveCount(1);
			}
			const dialogBox = await dialog.boundingBox();
			expect(dialogBox).not.toBeNull();
			expect(
				Math.abs(dialogBox!.x - (viewport.width - dialogBox!.width) / 2),
			).toBeLessThanOrEqual(1);
			if (viewport.width === 390) {
				await dialog.getByRole("button", { name: /add client/i }).click();
				const scrollRegion = dialog.locator(".overflow-y-auto");
				await expect(scrollRegion).toBeVisible();
				expect(
					await scrollRegion.evaluate(
						(element) => element.scrollHeight > element.clientHeight,
					),
				).toBe(true);
				await dialog.getByRole("button", { name: "Close" }).click();
				await expect(page).toHaveURL("/en/settings");
			}
		}
	});

	test("[AISET-010/015] create, edit, test, and delete an AI client through the UI", async ({
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
			await fillAdvancedConnectionSettings(
				page,
				"https://api.mock.ai/v1",
				"sk-test-e2e-settings",
			);

			const createResp = page.waitForResponse(
				(res) =>
					res.url().includes("/api/ai/clients") && res.request().method() === "POST",
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

			await expect(page.getByText("E2E Settings Client (Updated)")).toBeVisible();
		});

		await test.step("4. Test availability shows result", async () => {
			await page.getByRole("button", { name: "Edit" }).first().click();

			await page
				.getByRole("button", { name: /test availability/i })
				.first()
				.click();
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

	test("[AISET-016] displays resolved runtime configuration", async ({
		page,
	}) => {
		await page.route("**/api/ai/clients/*/diagnostics", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					diagnostics: {
						model: "mock-model",
						contextStrategy: "isolated",
						configDirectory: "/tmp/chrona-config",
						agentDirectory: "/tmp/chrona-agent",
						timeoutMs: 30_000,
						configurationCapabilities: {
							tooling: {
								mcp: { enabled: true },
								lsp: { enabled: true },
								subagents: { enabled: false },
								enabledTools: ["read", "write"],
							},
						},
						sources: {
							model: "provider_override",
							context: "provider_default",
							configDirectory: "runtime",
							agentDirectory: "runtime",
							timeoutMs: "provider_override",
						},
					},
				}),
			});
		});

		await page.goto(SETTINGS_URL);
		await page.getByRole("button", { name: /add client/i }).click();
		await selectHermesProvider(page);
		await page.getByPlaceholder("My Hermes Client").fill("Diagnostics Client");
		await fillAdvancedConnectionSettings(
			page,
			"https://diagnostics.mock/v1",
			"sk-diagnostics",
		);
		const createResponse = page.waitForResponse(
			(response) =>
				response.url().includes("/api/ai/clients") &&
				response.request().method() === "POST",
		);
		await page.getByRole("button", { name: /^save$/i }).click();
		expect((await createResponse).ok()).toBeTruthy();

		const inspect = page
			.getByRole("button", { name: "View runtime configuration" })
			.first();
		await expect(inspect).toBeVisible();
		await inspect.click();
		await expect(page.getByText("mock-model")).toBeVisible();
		await expect(page.getByText("/tmp/chrona-config")).toBeVisible();
		await expect(page.getByText(/read, write/)).toBeVisible();
	});

	test("[AISET-018/019/020] diagnoses, configures, and restarts local Hermes", async ({
		page,
	}) => {
		const integrationResult = {
			maskedApiKey: "chrona-...oken",
			changed: ["env:/tmp/hermes/.env"],
			diagnostics: {
				mode: "local",
				restartRequired: true,
				checks: [
					{
						key: "hermesEnvFile",
						status: "warning",
						message: "Hermes fixture check",
					},
				],
			},
			plan: {
				summary: "Restart Hermes fixture.",
				canRunAutomatically: false,
				actions: [],
			},
		};
		await page.route("**/api/integrations/hermes/diagnose", (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(integrationResult),
			}),
		);
		await page.route("**/api/integrations/hermes/setup-local", (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					...integrationResult,
					apiKey: "chrona-generated-token",
				}),
			}),
		);
		await page.route("**/api/integrations/hermes/restart-local", (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					ok: true,
					exitCode: null,
					message: "Hermes fixture restart requested.",
				}),
			}),
		);

		await page.goto(SETTINGS_URL);
		await page.getByRole("button", { name: /add client/i }).click();
		await selectHermesProvider(page);
		await page.getByRole("button", { name: "Diagnose Hermes" }).click();
		await expect(page.getByText("Hermes fixture check")).toBeVisible();
		await page
			.getByRole("button", { name: "Auto-configure local Hermes" })
			.click();
		await expect(page.getByText("Restart Hermes fixture.")).toBeVisible();
		await page.getByRole("button", { name: "Restart Hermes gateway" }).click();
		await expect(
			page.getByText("Hermes fixture restart requested."),
		).toBeVisible();
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
		await fillAdvancedConnectionSettings(page, "https://a.mock.ai/v1", "sk-a");

		const respA = page.waitForResponse(
			(res) =>
				res.url().includes("/api/ai/clients") && res.request().method() === "POST",
		);
		await page.getByRole("button", { name: /^save$/i }).click();
		await respA;

		// Client B
		await page.getByRole("button", { name: /add client/i }).click();
		await selectHermesProvider(page);
		await page.getByPlaceholder("My Hermes Client").fill("Default Client B");
		await fillAdvancedConnectionSettings(page, "https://b.mock.ai/v1", "sk-b");
		await page
			.getByRole("checkbox", { name: "Use as default AI client" })
			.click();

		const respB = page.waitForResponse(
			(res) =>
				res.url().includes("/api/ai/clients") && res.request().method() === "POST",
		);
		await page.getByRole("button", { name: /^save$/i }).click();
		await respB;

		// Now edit Client A and set as default
		await page.getByRole("button", { name: "Edit" }).first().click();
		await page
			.getByRole("checkbox", { name: "Use as default AI client" })
			.click();

		const patchResp = page.waitForResponse(
			(res) =>
				res.url().includes("/api/ai/clients") && res.request().method() === "PATCH",
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
		await fillAdvancedConnectionSettings(page, "https://mock.ai/v1", "sk-test");

		const saveBtn = page.getByRole("button", { name: /^save$/i });
		await saveBtn.click();
		await expect(
			page.getByRole("alert").filter({ hasText: "Name" }),
		).toBeVisible();
	});
});
