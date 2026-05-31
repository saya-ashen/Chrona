import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  listExternalCalendarSources: vi.fn(),
  refreshExternalCalendarSource: vi.fn(),
  updateExternalCalendarSource: vi.fn(),
}));

const listMock = vi.mocked(listExternalCalendarSources);
const updateMock = vi.mocked(updateExternalCalendarSource);
const refreshMock = vi.mocked(refreshExternalCalendarSource);
const deleteMock = vi.mocked(deleteExternalCalendarSource);
const errorMessageMock = vi.mocked(getExternalCalendarErrorMessage);

const activeSource = {
  id: "source-1",
  name: "Team calendar",
  sourceType: "subscription" as const,
  redactedUrlLabel: "calendar.example/team.ics",
  color: "#2563eb",
  syncPolicy: "auto_complete_past_events" as const,
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
    render(<CalendarSourceList workspaceId="workspace-1" />);

    expect(await screen.findByText("Team calendar")).toBeInTheDocument();
    expect(screen.getByText("calendar.example/team.ics")).toBeInTheDocument();
    expect(screen.getByText(/active/i)).toBeInTheDocument();
    expect(screen.getByText(/last successful refresh/i)).toBeInTheDocument();
    expect(screen.getByText(/next expected refresh/i)).toBeInTheDocument();
    expect(screen.getByText(/latest error/i)).toBeInTheDocument();
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

    const nameInput = await screen.findByLabelText(/display name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed calendar");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("workspace-1", "source-1", {
      name: "Renamed calendar",
      color: "#2563eb",
      syncPolicy: "auto_complete_past_events",
    }));

    await user.click(screen.getByRole("button", { name: /disable/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("workspace-1", "source-1", { enabled: false }));
    expect(await screen.findByRole("button", { name: /enable/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /enable/i }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("workspace-1", "source-1", { enabled: true }));

    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledWith("workspace-1", "source-1"));
    expect(await screen.findByText(/partial/i)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("confirms removal before deleting a source", async () => {
    const user = userEvent.setup();
    deleteMock.mockResolvedValueOnce({ removed: true, sourceId: "source-1" });

    render(<CalendarSourceList workspaceId="workspace-1" />);

    await screen.findByText("Team calendar");
    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(screen.getByText(/remove this calendar source/i)).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /remove/i }));
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

    expect(await screen.findByText("Calendar feed could not be read.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Calendar could not be reached.");
  });
});
