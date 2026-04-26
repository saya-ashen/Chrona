import { describe, expect, it } from "vitest";
import React from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { render, screen } from "@testing-library/react";

import { AppShell } from "../app-shell";
import { LocaleLandingPage } from "../pages";
import type { AppBootData } from "../pages";

const bootData: AppBootData = {
  locale: "en",
  dictionary: ({
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
  } as unknown) as AppBootData["dictionary"],
  defaultWorkspace: { id: "ws-1" } as AppBootData["defaultWorkspace"],
  schedule: {} as AppBootData["schedule"],
  inbox: {} as AppBootData["inbox"],
  memory: {} as AppBootData["memory"],
  workspaces: [] as AppBootData["workspaces"],
};

describe("localized root index route", () => {
  it("lets the child index route read the parent loader data", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/:lang",
          loader: async () => bootData,
          element: <AppShell />,
          children: [{ index: true, element: <LocaleLandingPage /> }],
        },
      ],
      { initialEntries: ["/en"] },
    );

    render(<RouterProvider router={router} />);

    await screen.findByText(/schedule/i);
    expect(router.state.location.pathname).toBe("/en/schedule");
  });
});
