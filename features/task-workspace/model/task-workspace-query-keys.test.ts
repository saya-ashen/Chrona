import { describe, expect, it } from "vitest";
import { taskWorkspaceQueryKeys } from "./task-workspace-query";

describe("task workspace query keys", () => {
	it("provides a prefix that invalidates every work-block page projection for a task", () => {
		const prefix = taskWorkspaceQueryKeys.pagePrefix("task-1");

		expect(taskWorkspaceQueryKeys.page("task-1", null)).toEqual([
			...prefix,
			null,
		]);
		expect(taskWorkspaceQueryKeys.page("task-1", "block-1")).toEqual([
			...prefix,
			"block-1",
		]);
		expect(prefix).toEqual(["task-workspace", "page", "task-1"]);
	});
});
