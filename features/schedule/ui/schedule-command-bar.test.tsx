import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@chrona/i18n/react", async () => {
	const { fallbackMessages } = await import("@chrona/i18n/messages");
	return {
		useI18n: () => ({ messages: fallbackMessages, t: (key: string) => key }),
		useLocale: () => "en",
	};
});

const mockUseAutoComplete = vi.fn();
vi.mock("./use-auto-complete", () => ({
	useAutoComplete: (...args: unknown[]) => mockUseAutoComplete(...args),
}));

import { ScheduleCommandBar } from "./schedule-command-bar";

function hookValue(overrides: Record<string, unknown> = {}) {
	return {
		structuredSuggestions: overrides.structuredSuggestions ?? [],
		suggestions: overrides.suggestions ?? [],
		isLoading: overrides.isLoading ?? false,
		error: overrides.error ?? null,
		phase: overrides.phase ?? "idle",
		statusMessage: overrides.statusMessage ?? null,
		toolCalls: overrides.toolCalls ?? [],
		toolResults: overrides.toolResults ?? [],
		partialText: overrides.partialText ?? "",
	};
}

describe("schedule quick create AI-only path", () => {
	const cryptoMock = { randomUUID: vi.fn(() => "trace-1") };

	beforeEach(() => {
		vi.stubGlobal("crypto", cryptoMock as unknown as Crypto);
		mockUseAutoComplete.mockReturnValue(hookValue());
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it("submits direct Chinese title using the current AI suggestion without truncation", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn().mockResolvedValue(undefined);

		mockUseAutoComplete.mockReturnValue(
			hookValue({
				structuredSuggestions: [
					{
						id: "s1",
						summary: "创建任务",
						action: {
							type: "create_task",
							title: "参加美国总统竞选",
							description: "",
							priority: "High",
							estimatedMinutes: 90,
							tags: [],
						},
					},
				],
				phase: "done",
				statusMessage: "Done",
				toolCalls: [
					{
						tool: "suggest_task_completions",
						input: { input: "参加美国总统竞选" },
					},
				],
				toolResults: [
					{
						tool: "suggest_task_completions",
						result: "Generated 1 suggestion",
					},
				],
				partialText: "drafting...",
			}),
		);

		render(
			<ScheduleCommandBar
				selectedDay="2026-04-15"
				isPending={false}
				onSubmit={onSubmit}
			/>,
		);

		await user.type(
			screen.getByPlaceholderText(/task title/i),
			"参加美国总统竞选",
		);
		await user.keyboard("{Enter}");

		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledTimes(1);
		});
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({ title: "参加美国总统竞选", priority: "High" }),
		);
	});

	it("[SCHED-027] preserves input on provider failure and succeeds on retry", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn().mockResolvedValue(undefined);
		mockUseAutoComplete.mockReturnValue(
			hookValue({
				structuredSuggestions: [],
				phase: "done",
				error: "Suggestion provider timed out",
			}),
		);
		const { rerender } = render(
			<ScheduleCommandBar
				selectedDay="2026-04-15"
				isPending={false}
				onSubmit={onSubmit}
			/>,
		);
		const input = screen.getByPlaceholderText(/task title/i);
		await user.type(input, "Schedule a review tomorrow");
		await user.keyboard("{Enter}");

		await waitFor(() =>
			expect(
				screen.getAllByText("Suggestion provider timed out").length,
			).toBeGreaterThan(0),
		);
		expect(input).toHaveValue("Schedule a review tomorrow");
		expect(onSubmit).not.toHaveBeenCalled();

		mockUseAutoComplete.mockReturnValue(
			hookValue({
				structuredSuggestions: [
					{
						id: "retry-suggestion",
						summary: "Schedule review",
						action: {
							type: "create_task",
							title: "Schedule a review tomorrow",
							description: "",
							priority: "Medium",
							estimatedMinutes: 30,
							tags: [],
						},
					},
				],
				phase: "done",
			}),
		);
		rerender(
			<ScheduleCommandBar
				selectedDay="2026-04-15"
				isPending={false}
				onSubmit={onSubmit}
			/>,
		);
		await user.keyboard("{Enter}");

		await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
	});

	it("returns explainable error when no AI suggestion is available instead of silently creating", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn().mockResolvedValue(undefined);

		mockUseAutoComplete.mockReturnValue(
			hookValue({ structuredSuggestions: [], phase: "done", error: null }),
		);

		render(
			<ScheduleCommandBar
				selectedDay="2026-04-15"
				isPending={false}
				onSubmit={onSubmit}
			/>,
		);

		await user.type(
			screen.getByPlaceholderText(/task title/i),
			"参加美国总统竞选",
		);
		await user.keyboard("{Enter}");

		await waitFor(() => {
			expect(
				screen.getAllByText(/could not understand this input safely/i).length,
			).toBeGreaterThan(0);
		});
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
