import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarSourceList } from "@/components/schedule/calendar-source-list";
import {
  deleteExternalCalendarSource,
  getExternalCalendarErrorMessage,
  listExternalCalendarSources,
  refreshExternalCalendarSource,
  updateExternalCalendarSource,
} from "@/lib/external-calendar-client";

vi.mock("@/lib/external-calendar-client", () => ({
  deleteExternalCalendarSource: vi.fn(),
  getExternalCalendarErrorMessage: vi.fn((error: unknown) => error instanceof Error ? error.message : "Calendar source failed"),
  isBlockedNetworkCalendarError: vi.fn((error: unknown) => Boolean(
    error && typeof error === "object" && "data" in error && (error as { data?: { errorCode?: string } }).data?.errorCode === "blocked_network",
  )),
  listExternalCalendarSources: vi.fn(),
  refreshExternalCalendarSource: vi.fn(),
  updateExternalCalendarSource: vi.fn(),
}));

const listMock = listExternalCalendarSources as ReturnType<typeof vi.fn>;
const updateMock = updateExternalCalendarSource as ReturnType<typeof vi.fn>;
const refreshMock = refreshExternalCalendarSource as ReturnType<typeof vi.fn>;
const deleteMock = deleteExternalCalendarSource as ReturnType<typeof vi.fn>;
const errorMessageMock = getExternalCalendarErrorMessage as ReturnType<typeof vi.fn>;

const activeSource = {
  id: "source-1",
  name: "Team calendar",
  sourceType: "subscription" as const,
  redactedUrlLabel: "calendar.example/team.ics",
  color: "#2563eb",
  syncPolicy: "auto_complete_past_events" as const,
  automationPolicy: "auto_plan" as const,
  lifecycleState: "active" as const,
  lastSuccessfulRefreshAt: "2026-05-30T10:00:00.000Z",
  nextExpectedRefreshAt: "2026-05-30T11:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CalendarSourceList", () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ sources: [activeSource] });
  });

  it("renders source health fields and redacted URL labels", async () => {
    const user = userEvent.setup();
    render(<CalendarSourceList workspaceId="workspace-1" />);

    expect(await screen.findByText("Team calendar")).toBeInTheDocument();
    expect(screen.getByText("calendar.example/team.ics")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /manage/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/last successful refresh/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/next expected refresh/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/latest error/i)).toBeInTheDocument();
  });

  it("renames, recolors, disables, enables, and refreshes a source", async () => {
    const user = userEvent.setup();
    updateMock
      .mockResolvedValueOnce({ source: { ...activeSource, name: "Renamed calendar", color: "#0f766e" } })
      .mockResolvedValueOnce({ source: { ...activeSource, name: "Renamed calendar", color: "#0f766e", lifecycleState: "disabled" } })
      .mockResolvedValueOnce({ source: { ...activeSource, name: "Renamed calendar", color: "#0f766e", lifecycleState: "active" } });
    refreshMock.mockResolvedValueOnce({
      source: { ...activeSource, name: "Renamed calendar", color: "#0f766e", lifecycleState: "active" },
      syncStatus: { sourceId: "source-1", state: "partial", importedCount: 2, skippedCount: 1 },
    });

    render(<CalendarSourceList workspaceId="workspace-1" />);

    await user.click(await screen.findByRole("button", { name: /manage/i }));
    const dialog = await screen.findByRole("dialog");
    const nameInput = within(dialog).getByLabelText(/display name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed calendar");
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("workspace-1", "source-1", {
      name: "Renamed calendar",
      color: "#2563eb",
      syncPolicy: "auto_complete_past_events",
      automationPolicy: "auto_plan",
    }));

    await user.click(within(dialog).getByRole("button", { name: /disable/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("workspace-1", "source-1", { enabled: false }));
    expect(await within(dialog).findByRole("button", { name: /enable/i })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /enable/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("workspace-1", "source-1", { enabled: true }));

    await user.click(within(dialog).getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledWith("workspace-1", "source-1"));
    expect(await within(dialog).findByText(/partial/i)).toBeInTheDocument();
    expect(within(dialog).getByText("2")).toBeInTheDocument();
  });

  it("asks for confirmation before refreshing a blocked-network calendar", async () => {
    const user = userEvent.setup();
    const error = { data: { errorCode: "blocked_network" } };
    refreshMock.mockRejectedValueOnce(error);
    refreshMock.mockResolvedValueOnce({
      source: activeSource,
      syncStatus: { sourceId: "source-1", state: "success", importedCount: 2, skippedCount: 0 },
    });
    errorMessageMock.mockReturnValueOnce("This calendar resolves through a private or proxy network.");

    render(<CalendarSourceList workspaceId="workspace-1" />);

    await user.click(await screen.findByRole("button", { name: /manage/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /refresh/i }));

    const confirmDialog = await screen.findByRole("dialog", { name: /confirm proxy calendar access/i });
    await user.click(within(confirmDialog).getByRole("button", { name: /trust and continue/i }));

    await waitFor(() => expect(refreshMock).toHaveBeenLastCalledWith("workspace-1", "source-1", { allowBlockedNetwork: true }));
  });

  it("confirms removal before deleting a source", async () => {
    const user = userEvent.setup();
    deleteMock.mockResolvedValueOnce({ removed: true, sourceId: "source-1" });

    render(<CalendarSourceList workspaceId="workspace-1" />);

    await screen.findByText("Team calendar");
    await user.click(screen.getByRole("button", { name: /manage/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /remove/i }));
    expect(within(dialog).getByText(/remove this calendar source/i)).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: /remove/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("workspace-1", "source-1"));
    expect(screen.queryByText("Team calendar")).not.toBeInTheDocument();
  });

  it("shows latest errors from source health and action failures", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValueOnce({
      sources: [{
        ...activeSource,
        lastErrorCode: "malformed_calendar",
        lastErrorMessage: "Calendar feed could not be read.",
      }],
    });
    const error = new Error("Refresh failed");
    refreshMock.mockRejectedValueOnce(error);
    errorMessageMock.mockReturnValueOnce("Calendar could not be reached.");

    render(<CalendarSourceList workspaceId="workspace-1" />);

    await user.click(await screen.findByRole("button", { name: /manage/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Calendar feed could not be read.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /refresh/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Calendar could not be reached.");
  });
});
