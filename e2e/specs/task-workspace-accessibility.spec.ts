import { expect, test } from "@playwright/test";
import {
	formatAccessibilityViolations,
	scanPageAccessibility,
} from "./accessibility-test-helpers";
import {
	createTaskWorkspaceTask,
	getPrimaryTaskWorkspaceAction,
	setTaskWorkspaceViewport,
} from "./task-workspace-test-helpers";

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
		await page.keyboard.press("Escape");
		await expect(page.getByPlaceholder("Add title")).not.toBeVisible();
		await expect
			.poll(async () =>
				page.evaluate(
					() =>
						document.activeElement?.textContent?.includes("New Task") ?? false,
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
		await expect(page.getByRole("dialog")).toBeVisible();
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
});
