import { createBrowserRouter, Navigate } from "react-router-dom";

import { defaultLocale, hasLocale } from "@chrona/i18n";

import { AppShell } from "./app-shell";
import { AccessKeyRouteError } from "@/components/access-key-route-error";
import {
  ActionCenterRoutePage,
  DashboardRoutePage,
  LocaleLandingPage,
  GoalListRoutePage,
  GoalWorkspaceRoutePage,
  ScheduleRoutePage,
  SettingsRoutePage,
  TaskDetailRoutePage,
  TaskListRoutePage,
} from "./pages";
import { NotFoundPage } from "@/components/not-found-page";
import {
  loadAppBootData,
  loadActionCenterRouteData,
  loadDashboardRouteData,
  loadGoalListData,
  loadGoalWorkspaceData,
  loadScheduleRouteData,
  loadTaskListData,
  loadTaskPageData,
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
      errorElement: <AccessKeyRouteError />,
      hydrateFallbackElement: <div aria-hidden="true" />,
      children: [
        {
          index: true,
          element: <LocaleLandingPage />,
        },
        {
          path: "dashboard",
          loader: loadDashboardRouteData,
          element: <DashboardRoutePage />,
        },
        {
          path: "schedule",
          loader: loadScheduleRouteData,
          element: <ScheduleRoutePage />,
        },
        {
          path: "action-center",
          loader: loadActionCenterRouteData,
          element: <ActionCenterRoutePage />,
        },
        {
          path: "goals",
          loader: loadGoalListData,
          element: <GoalListRoutePage />,
        },
        {
          path: "goals/:goalId",
          loader: loadGoalWorkspaceData,
          element: <GoalWorkspaceRoutePage />,
        },
        {
          path: "tasks",
          loader: loadTaskListData,
          element: <TaskListRoutePage />,
        },
        {
          path: "settings",
          element: <SettingsRoutePage />,
        },
        {
          path: "tasks/:taskId",
          loader: loadTaskPageData,
          element: <TaskDetailRoutePage />,
        },
        {
          path: "*",
          element: <NotFoundPage />,
        },
      ],
    },
  ]);
}
