import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/client", () => ({
  useI18n: () => ({ messages: {} }),
  useLocale: () => "en",
}));

import { ScheduleCommandBar } from "@/components/schedule/schedule-command-bar";
import {
  buildQuickCreateDraft,
  parseQuickCreateCommand,
} from "@/components/schedule/schedule-page-utils";

afterEach(() => {
  cleanup();
});

describe("schedule quick create", () => {
  it("parses a quick-create command into a normalized draft", () => {
    const draft = parseQuickCreateCommand(
      "Write weekly report @ 14:30 for 90m !high",
      new Date(2026, 3, 15, 8, 0, 0, 0),
    );

    expect(draft).toMatchObject({
      title: "Write weekly report",
      priority: "High",
      scheduledStartAt: new Date(2026, 3, 15, 14, 30, 0, 0),
      scheduledEndAt: new Date(2026, 3, 15, 16, 0, 0, 0),
    });
  });

  it("builds a fallback quick-create draft when the command omits scheduling details", () => {
    const draft = buildQuickCreateDraft({
      title: "Inbox triage",
      selectedDay: "2026-04-15",
      now: new Date(2026, 3, 15, 8, 10, 0, 0),
    });

    expect(draft).toMatchObject({
      title: "Inbox triage",
      priority: "Medium",
      scheduledStartAt: new Date(2026, 3, 15, 8, 15, 0, 0),
      scheduledEndAt: new Date(2026, 3, 15, 9, 15, 0, 0),
    });
  });

  it("submits a parsed quick-create draft to the page orchestration", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ScheduleCommandBar
        selectedDay="2026-04-15"
        isPending={false}
        onSubmit={onSubmit}
      />,
    );

    await user.type(
      screen.getByPlaceholderText(/task title/i),
      "Write weekly report @ 14:30 for 90m !high",
    );
    await user.click(screen.getByRole("button", { name: /add block/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Write weekly report",
        priority: "High",
        scheduledStartAt: new Date(2026, 3, 15, 14, 30, 0, 0),
        scheduledEndAt: new Date(2026, 3, 15, 16, 0, 0, 0),
      }),
    );
  });
});
