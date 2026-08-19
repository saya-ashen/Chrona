import { expect, test } from "@playwright/test";
import {
	formatAccessibilityViolations,
	scanPageAccessibility,
} from "./accessibility-test-helpers";
import {
	bindTaskDebugExecutionFeatures,
	createTaskWorkspaceTask,
	generateTaskWorkspacePlan,
	getPrimaryTaskWorkspaceAction,
	setTaskWorkspaceViewport,
} from "./task-workspace-test-helpers";
import {
	bindTaskPlanProvider,
	startMockTaskPlanProvider,
} from "./mock-task-plan-provider";
import type { Locator, Page } from "@playwright/test";

async function expectDialogFocusContained(page: Page, dialog: Locator) {
	for (let index = 0; index < 8; index += 1) {
		await page.keyboard.press("Tab");
		await expect(dialog.locator(":focus")).toHaveCount(1);
	}
}

test.describe("Task workspace accessibility", () => {
	test("reaches primary schedule actions by keyboard and restores dialog focus", async ({
		page,
	}) => {
		await setTaskWorkspaceViewport(page, "desktop");
		await page.goto("/en/schedule");

		const newTask = getPrimaryTaskWorkspaceAction(page, "New Task");
		await expect(newTask).toBeVisible();
		await newTask.focus();
		await expect(newTask).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(page.getByPlaceholder("Add title")).toBeVisible();
		await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
		await expectDialogFocusContained(page, page.getByRole("dialog"));
		await page.keyboard.press("Escape");
		await expect(page.getByPlaceholder("Add title")).not.toBeVisible();
		await expect
			.poll(async () =>
				page.evaluate(
					() => document.activeElement?.textContent?.includes("New Task") ?? false,
				),
			)
			.toBe(true);
	});

	test("keeps the task workspace primary action keyboard-operable and axe-clean", async ({
		page,
		request,
	}, testInfo) => {
		const viewport =
			testInfo.project.name === "chromium"
				? "desktop"
				: (testInfo.project.name as "tablet" | "mobile");
		await setTaskWorkspaceViewport(page, viewport);
		const task = await createTaskWorkspaceTask(request, {
			title: `Accessible workspace ${viewport} ${Date.now()}`,
			description: "Verify keyboard access, focus, and accessible structure.",
		});

		const consoleErrors: string[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		await page.goto(`/en/tasks/${task.taskId}`);
		const primaryAction = page
			.getByRole("link", { name: "Connect AI provider" })
			.or(page.getByRole("button", { name: /^Generate plan$/ }));
		await expect(primaryAction).toHaveCount(1);
		await primaryAction.focus();
		await expect(primaryAction).toBeFocused();

		const editTask = page
			.getByRole("complementary", { name: "Plan creation action" })
			.getByRole("button", { name: /^Edit task brief$/ });
		await editTask.focus();
		await page.keyboard.press("Enter");
		const editDialog = page.getByRole("dialog");
		await expect(editDialog).toBeVisible();
		await expectDialogFocusContained(page, editDialog);
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).not.toBeVisible();
		await expect(editTask).toBeFocused();

		const { violations } = await scanPageAccessibility(page);
		expect(consoleErrors).toEqual([]);
		const blocking = violations.filter(
			(violation) =>
				violation.impact === "critical" || violation.impact === "serious",
		);
		expect(formatAccessibilityViolations(blocking)).toEqual([]);
		await expect
			.poll(async () =>
				page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			)
			.toBe(true);
	});

	test("[CROSS-005] keeps critical product pages axe-clean", async ({
		page,
	}, testInfo) => {
		const viewport =
			testInfo.project.name === "chromium"
				? "desktop"
				: (testInfo.project.name as "tablet" | "mobile");
		await setTaskWorkspaceViewport(page, viewport);

		for (const path of [
			"/en",
			"/en/schedule",
			"/en/tasks",
			"/en/action-center",
			"/en/goals",
			"/en/settings",
		]) {
			await page.goto(path);
			await expect(page.getByRole("main")).toBeVisible();
			const { violations } = await scanPageAccessibility(page);
			const blocking = violations.filter(
				(violation) =>
					violation.impact === "critical" || violation.impact === "serious",
			);
			expect(
				formatAccessibilityViolations(blocking),
				`${path} has blocking accessibility violations`,
			).toEqual([]);
		}
	});

	test("completes task lifecycle with keyboard-only controls", async ({
		page,
		request,
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== "chromium",
			"Keyboard lifecycle runs on desktop only.",
		);
		test.setTimeout(180_000);
		await setTaskWorkspaceViewport(page, "desktop");

		const title = `Keyboard lifecycle ${Date.now()}`;
		await page.goto("/en/tasks");
		const newTask = page.getByRole("button", { name: "New Task" }).first();
		await newTask.focus();
		await page.keyboard.press("Enter");
		const dialog = page.getByRole("dialog", { name: "Add task" });
		await expect(dialog).toBeVisible();
		const saveAsTask = dialog.getByRole("radio", { name: /Save as task/ });
		await saveAsTask.focus();
		await page.keyboard.press("Space");
		await expect(saveAsTask).toBeChecked();
		const titleInput = dialog.getByRole("textbox", { name: "Title" });
		await titleInput.focus();
		await page.keyboard.type(title);
		const descriptionInput = dialog.getByRole("textbox", {
			name: "Add description",
		});
		await descriptionInput.focus();
		await page.keyboard.type("Keyboard-only lifecycle regression.");
		const createResponse = page.waitForResponse(
			(response) =>
				response.url().endsWith("/api/tasks") &&
				response.request().method() === "POST",
		);
		const save = dialog.getByRole("button", { name: "Save", exact: true });
		await save.focus();
		await page.keyboard.press("Enter");
		const created = (await (await createResponse).json()) as { taskId?: string };
		expect(created.taskId).toBeTruthy();

		await bindTaskDebugExecutionFeatures(request, created.taskId!);
		await generateTaskWorkspacePlan(request, created.taskId!);
		const finalizationProvider = await startMockTaskPlanProvider();
		try {
			await bindTaskPlanProvider(
				request,
				created.taskId!,
				finalizationProvider.baseUrl,
				["task.result_finalization"],
			);
			await page.goto(`/en/tasks/${created.taskId}`);
			await expect(page.getByTestId("accepted-plan-surface")).toBeVisible();

			const start = page.getByRole("button", { name: "Start", exact: true });
			await start.focus();
			await page.keyboard.press("Enter");
			const inputPanel = page.getByRole("tabpanel", { name: "Provide input" });
			await expect(inputPanel).toBeVisible({ timeout: 30_000 });
			const typeInto = async (name: string, value: string) => {
				const input = inputPanel.getByRole("textbox", { name });
				await input.focus();
				await page.keyboard.type(value);
			};
			await typeInto("Scenario label", "fast");
			await typeInto("Include slow wait path", "false");
			const priority = inputPanel.getByRole("combobox");
			await priority.focus();
			await page.keyboard.type("normal");
			const submitInput = inputPanel.getByRole("button", { name: "Submit input" });
			await submitInput.focus();
			await page.keyboard.press("Enter");

			const secondInputPanel = page.getByRole("tabpanel", {
				name: "Provide input",
			});
			await expect(secondInputPanel).toBeVisible({ timeout: 30_000 });
			const branchInput = secondInputPanel.getByRole("textbox", {
				name: "Submit input",
			});
			await branchInput.focus();
			await page.keyboard.type("fast path");
			const submitBranch = secondInputPanel.getByRole("button", {
				name: "Submit input",
			});
			await submitBranch.focus();
			await page.keyboard.press("Enter");

			const approve = page.getByRole("button", { name: "Approve result" });
			await expect(approve).toBeVisible({ timeout: 30_000 });
			await approve.focus();
			await page.keyboard.press("Enter");
			const manualInput = page.getByRole("textbox", { name: "Mark completed" });
			await expect(manualInput).toBeVisible({ timeout: 30_000 });
			await manualInput.focus();
			await page.keyboard.type("Manual review completed by keyboard");
			const markCompleted = page.getByRole("button", { name: "Mark completed" });
			await markCompleted.focus();
			await page.keyboard.press("Enter");

			const acceptResult = page.getByRole("button", { name: "Accept result" });
			await expect(acceptResult).toBeVisible({ timeout: 40_000 });
			await acceptResult.focus();
			await page.keyboard.press("Enter");
			const confirmation = page.getByRole("dialog", {
				name: "Confirm result acceptance",
			});
			await expect(confirmation).toBeVisible();
			await expectDialogFocusContained(page, confirmation);
			const confirm = confirmation.getByRole("button", {
				name: "Confirm acceptance",
			});
			await confirm.focus();
			await page.keyboard.press("Enter");
			await expect(
				page.getByRole("heading", { name: "Result accepted" }),
			).toBeVisible({
				timeout: 30_000,
			});
		} finally {
			await finalizationProvider.stop();
		}
	});
});
