import { describe, expect, it } from "vitest";
import React from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { act, render, waitFor } from "@testing-library/react";

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
    },
    components: {
      inboxList: {},
      memoryConsole: {},
      taskPage: {},
    },
  } as unknown) as AppBootData["dictionary"],
  defaultWorkspace: { id: "ws-1" } as AppBootData["defaultWorkspace"],
};


describe("localized root index route", () => {
  it("navigates from /:lang to /:lang/dashboard", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/:lang",
          loader: async () => bootData,
          element: <AppShell />,
          children: [
            { index: true, element: <LocaleLandingPage /> },
            { path: "dashboard", element: <div>Dashboard</div> },
          ],
        },
      ],
      { initialEntries: ["/en"] },
    );

    const view = render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/en/dashboard");
    });

    await act(async () => {
      view.unmount();
    });
  });
});
