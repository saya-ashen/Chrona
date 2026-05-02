import { createBrowserRouter, Navigate } from "react-router-dom";

import { defaultLocale, hasLocale } from "@/i18n/config";

import { AppShell } from "./app-shell";
import {
  InboxRoutePage,
  LocaleLandingPage,
  MemoryRoutePage,
  ScheduleRoutePage,
  SettingsRoutePage,
  TaskDetailRoutePage,
  TaskListRoutePage,
  WorkRoutePage,
  WorkbenchHubRoutePage,
  WorkspaceOverviewRoutePage,
  WorkspacesRoutePage,
} from "./pages";
import { NotFoundPage } from "@/components/not-found-page";
import {
  loadAppBootData,
  loadTaskListData,
  loadTaskPageData,
  loadWorkPageData,
  loadWorkbenchHubData,
  loadWorkspaceOverviewData,
} from "./loaders";

function redirectToDefaultLocale(pathname: string, search: string, hash: string) {
  return `${window.location.origin}/${defaultLocale}${pathname}${search}${hash}`;
}

export function createAppRouter() {
  return createBrowserRouter([
    {
      path: "/",
      element: <Navigate to={`/${defaultLocale}`} replace />,
    },
    {
      path: "/:lang",
      loader: ({ params, request }) => {
        if (!params.lang || !hasLocale(params.lang)) {
          const url = new URL(request.url);
          throw Response.redirect(redirectToDefaultLocale(url.pathname, url.search, url.hash), 302);
        }
        return loadAppBootData({ params, request } as Parameters<typeof loadAppBootData>[0]);
      },
      element: <AppShell />,
      children: [
        {
          index: true,
          element: <LocaleLandingPage />,
        },
        {
          path: "schedule",
          element: <ScheduleRoutePage />,
        },
        {
          path: "inbox",
          element: <InboxRoutePage />,
        },
        {
          path: "memory",
          element: <MemoryRoutePage />,
        },
        {
          path: "tasks",
          loader: loadTaskListData,
          element: <TaskListRoutePage />,
        },
        {
          path: "workbench",
          loader: loadWorkbenchHubData,
          element: <WorkbenchHubRoutePage />,
        },
        {
          path: "settings",
          element: <SettingsRoutePage />,
        },
        {
          path: "workspaces",
          element: <WorkspacesRoutePage />,
        },
        {
          path: "workspaces/:workspaceId",
          loader: loadWorkspaceOverviewData,
          element: <WorkspaceOverviewRoutePage />,
        },
        {
          path: "workspaces/:workspaceId/tasks/:taskId",
          loader: loadTaskPageData,
          element: <TaskDetailRoutePage />,
        },
        {
          path: "workspaces/:workspaceId/work/:taskId",
          loader: loadWorkPageData,
          element: <WorkRoutePage />,
        },
        {
          path: "*",
          element: <NotFoundPage />,
        },
      ],
    },
  ]);
}
