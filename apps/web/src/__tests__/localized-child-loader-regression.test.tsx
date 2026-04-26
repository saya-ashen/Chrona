import { describe, expect, it } from "vitest";
import React from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { render, waitFor } from "@testing-library/react";

import { hydrateSchedulePageData } from "@/components/schedule/schedule-page-utils";
import { AppShell } from "../app-shell";
import { LocaleLandingPage, ScheduleRoutePage } from "../pages";
import type { AppBootData } from "../pages";

const bootData: AppBootData = {
  locale: "en",
  dictionary: {
    common: {},
    navigation: {},
    pages: {
      inbox: { title: "Inbox", subtitle: "subtitle" },
      memory: { title: "Memory", subtitle: "subtitle" },
      settings: {
        title: "Settings",
        subtitle: "subtitle",
        aiClientsDescription: "ai desc",
        manageAiClients: "manage",
        scheduleAiTitle: "schedule ai",
        scheduleAiDescription: "schedule ai desc",
        advancedTitle: "advanced",
        advancedDescription: "advanced desc",
        openAdvancedSettings: "open",
      },
      workspaces: {
        title: "Workspaces",
        subtitle: "subtitle",
        notice: "notice",
        taskCountOne: "task",
        taskCountOther: "tasks",
      },
      workspaceOverview: { title: "Overview", subtitle: "subtitle" },
    },
    components: {
      inboxList: {},
      memoryConsole: {},
      taskPage: {},
    },
  } as AppBootData["dictionary"],
  defaultWorkspace: { id: "ws-1" } as AppBootData["defaultWorkspace"],
  schedule: hydrateSchedulePageData({
    defaultRuntimeAdapterKey: "openclaw",
    runtimeAdapters: [],
    summary: {
      scheduledCount: 0,
      unscheduledCount: 0,
      proposalCount: 0,
      riskCount: 0,
    },
    planningSummary: {
      scheduledMinutes: 0,
      runnableQueueCount: 0,
      conflictCount: 0,
      overloadedDayCount: 0,
      proposalCount: 0,
      riskCount: 0,
      todayLoadMinutes: 0,
      overdueCount: 0,
      atRiskCount: 0,
      readyToScheduleCount: 0,
      autoRunnableCount: 0,
      waitingOnUserCount: 0,
      dueSoonUnscheduledCount: 0,
      largestIdleWindowMinutes: 0,
      overloadedMinutes: 0,
    },
    focusZones: [],
    automationCandidates: [],
    scheduled: [],
    unscheduled: [],
    proposals: [],
    risks: [],
    listItems: [],
    conflicts: [],
    suggestions: [],
  } as AppBootData["schedule"]),
  inbox: {} as AppBootData["inbox"],
  memory: {} as AppBootData["memory"],
  workspaces: [] as AppBootData["workspaces"],
};

describe("localized child pages under /:lang", () => {
  it("navigates from /:lang to /:lang/schedule without crashing", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/:lang",
          loader: async () => bootData,
          element: <AppShell />,
          children: [
            { index: true, element: <LocaleLandingPage /> },
            { path: "schedule", element: <ScheduleRoutePage /> },
          ],
        },
      ],
      { initialEntries: ["/en"] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/en/schedule");
    });
  });
});
