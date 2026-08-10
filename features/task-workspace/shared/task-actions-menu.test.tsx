import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TaskActionsMenu } from "./task-actions-menu";

describe("TaskActionsMenu", () => {
	it("opens from a pointer click and invokes an item", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();

		render(
			<TaskActionsMenu
				label="Task actions"
				items={[{ id: "complete", label: "Complete", onSelect }]}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Task actions" }));
		expect(screen.getByRole("menu")).toBeVisible();

		await user.click(screen.getByRole("menuitem", { name: "Complete" }));
		expect(onSelect).toHaveBeenCalledOnce();
	});
});
