import { describe, expect, it } from "vitest";
import { getScheduleQuickCreateTimes } from "./schedule-page-dialogs";

describe("getScheduleQuickCreateTimes", () => {
	it("anchors quick-create defaults to the selected schedule day", () => {
		const { start, end } = getScheduleQuickCreateTimes(
			new Date(2026, 7, 7, 18, 30),
		);

		expect(start).toEqual(new Date(2026, 7, 7, 9, 0, 0, 0));
		expect(end).toEqual(new Date(2026, 7, 7, 10, 0, 0, 0));
	});
});
