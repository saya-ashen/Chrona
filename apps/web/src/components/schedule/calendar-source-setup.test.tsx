import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarSourceSetup } from "@/components/schedule/calendar-source-setup";
import {
  createExternalCalendarSource,
  getExternalCalendarErrorMessage,
  listExternalCalendarSources,
  validateCalendarSource,
} from "@/lib/external-calendar-client";

vi.mock("@/lib/external-calendar-client", () => ({
  createExternalCalendarSource: vi.fn(),
  getExternalCalendarErrorMessage: vi.fn((error: unknown) => error instanceof Error ? error.message : "Calendar source failed"),
  isBlockedNetworkCalendarError: vi.fn((error: unknown) => Boolean(
    error && typeof error === "object" && "data" in error && (error as { data?: { errorCode?: string } }).data?.errorCode === "blocked_network",
  )),
  listExternalCalendarSources: vi.fn(),
  validateCalendarSource: vi.fn(),
}));

const validateMock = vi.mocked(validateCalendarSource);
const createMock = vi.mocked(createExternalCalendarSource);
const errorMessageMock = vi.mocked(getExternalCalendarErrorMessage);
const listMock = vi.mocked(listExternalCalendarSources);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CalendarSourceSetup", () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ sources: [] });
  });

  it("renders read-only guidance and empty connected-source state", () => {
    render(<CalendarSourceSetup workspaceId="workspace-1" />);

    expect(screen.getByRole("heading", { name: /connect external calendar/i })).toBeInTheDocument();
    expect(screen.getAllByText(/read-only/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/no external calendars connected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect calendar/i })).toBeInTheDocument();
  });

  it("validates a source link and shows preview feedback", async () => {
    const user = userEvent.setup();
    validateMock.mockResolvedValueOnce({
      valid: true,
      detectedName: "Engineering Calendar",
      eventPreviewCount: 3,
      redactedUrlLabel: "calendar.example.test",
      warnings: [],
    });

    render(<CalendarSourceSetup workspaceId="workspace-1" />);

    await user.click(screen.getByRole("button", { name: /connect calendar/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/calendar url/i), "https://calendar.example.test/team.ics?token=secret");
    await user.click(within(dialog).getByRole("button", { name: /^validate$/i }));

    await waitFor(() => {
      expect(validateMock).toHaveBeenCalledWith("workspace-1", "https://calendar.example.test/team.ics?token=secret", undefined);
    });
    expect(screen.getByText(/calendar link validated/i)).toBeInTheDocument();
    expect(screen.getByText(/3 events/i)).toBeInTheDocument();
    expect(screen.getByText(/calendar.example.test/i)).toBeInTheDocument();
  });

  it("creates a source and shows imported event count", async () => {
    const user = userEvent.setup();
    createMock.mockResolvedValueOnce({
      source: {
        id: "source-1",
        name: "Team calendar",
        sourceType: "subscription",
        redactedUrlLabel: "team.ics",
        color: "#2563eb",
        syncPolicy: "auto_complete_past_events",
        automationPolicy: "auto_plan",
        lifecycleState: "active",
      },
      syncStatus: {
        sourceId: "source-1",
        state: "success",
        importedCount: 4,
        skippedCount: 0,
      },
    });

    render(<CalendarSourceSetup workspaceId="workspace-1" />);

    await user.click(screen.getByRole("button", { name: /connect calendar/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/display name/i), "Team calendar");
    await user.type(within(dialog).getByLabelText(/calendar url/i), "https://calendar.example.test/team.ics");
    await user.click(within(dialog).getByRole("button", { name: /connect calendar/i }));

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith("workspace-1", {
        name: "Team calendar",
        url: "https://calendar.example.test/team.ics",
        color: "#2563eb",
        syncPolicy: "auto_complete_past_events",
        automationPolicy: "auto_plan",
        allowBlockedNetwork: undefined,
      });
    });
    expect(await screen.findByText(/Team calendar/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage/i })).toBeInTheDocument();
  });

  it("asks for confirmation before connecting a blocked-network calendar", async () => {
    const user = userEvent.setup();
    const error = { data: { errorCode: "blocked_network" } };
    createMock.mockRejectedValueOnce(error);
    createMock.mockResolvedValueOnce({
      source: {
        id: "source-1",
        name: "Proxy calendar",
        sourceType: "subscription",
        redactedUrlLabel: "calendar.google.com/basic.ics",
        color: "#2563eb",
        syncPolicy: "auto_complete_past_events",
        automationPolicy: "auto_plan",
        lifecycleState: "active",
      },
      syncStatus: { sourceId: "source-1", state: "success", importedCount: 1, skippedCount: 0 },
    });
    errorMessageMock.mockReturnValueOnce("This calendar resolves through a private or proxy network.");

    render(<CalendarSourceSetup workspaceId="workspace-1" />);

    await user.click(screen.getByRole("button", { name: /connect calendar/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/display name/i), "Proxy calendar");
    await user.type(within(dialog).getByLabelText(/calendar url/i), "https://calendar.google.com/basic.ics");
    await user.click(within(dialog).getByRole("button", { name: /connect calendar/i }));

    const confirmDialog = await screen.findByRole("dialog", { name: /confirm proxy calendar access/i });
    await user.click(within(confirmDialog).getByRole("button", { name: /trust and continue/i }));

    await waitFor(() => expect(createMock).toHaveBeenLastCalledWith("workspace-1", expect.objectContaining({
      allowBlockedNetwork: true,
    })));
  });

  it("maps invalid-link errors into actionable feedback", async () => {
    const user = userEvent.setup();
    const error = new Error("Unsupported calendar link");
    createMock.mockRejectedValueOnce(error);
    errorMessageMock.mockReturnValueOnce("Use an http, https, or file calendar link.");

    render(<CalendarSourceSetup workspaceId="workspace-1" />);

    await user.click(screen.getByRole("button", { name: /connect calendar/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/display name/i), "Bad calendar");
    await user.type(within(dialog).getByLabelText(/calendar url/i), "ftp://calendar.example.test/team.ics");
    await user.click(within(dialog).getByRole("button", { name: /connect calendar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Use an http, https, or file calendar link.");
    expect(screen.getByText(/no external calendars connected/i)).toBeInTheDocument();
  });
});
