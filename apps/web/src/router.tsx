import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";

import { defaultLocale, hasLocale } from "@chrona/i18n";

import { AppShell } from "./app-shell";
import { AccessKeyRouteError } from "@/components/access-key-route-error";
import {
  ActionCenterRoutePage,
  DashboardRoutePage,
  LocaleLandingPage,
  GoalListRoutePage,
  GoalWorkspaceRoutePage,
  GoalTaskInspectorRoutePage,
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
  loadGoalTaskInspectorData,
  loadScheduleRouteData,
  loadTaskListData,
  loadTaskPageData,
} from "./loaders";
function DefaultLocaleRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={`/${defaultLocale}${search}${hash}`} replace />;
}

function redirectToDefaultLocale(
  pathname: string,
  search: string,
  hash: string,
  invalidLocale: string,
) {
  const invalidPrefix = `/${invalidLocale}`;
  const localizedPath = pathname === invalidPrefix ? "" : pathname.slice(invalidPrefix.length);
  return `${window.location.origin}/${defaultLocale}${localizedPath}${search}${hash}`;
}

export function createAppRouter() {
  return createBrowserRouter([
    {
      path: "/",
      element: <DefaultLocaleRedirect />,
    },
    {
      path: "/:lang",
      loader: ({ params, request }) => {
        if (!params.lang || !hasLocale(params.lang)) {
          const url = new URL(request.url);
          throw Response.redirect(
            redirectToDefaultLocale(url.pathname, url.search, url.hash, params.lang ?? ""),
            302,
          );
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
          path: "goals/:goalId/workbench/tasks/:taskId",
          loader: loadGoalTaskInspectorData,
          element: <GoalTaskInspectorRoutePage />,
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
