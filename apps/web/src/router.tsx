import { createBrowserRouter, Navigate } from "react-router-dom";

import { defaultLocale, hasLocale } from "@chrona/i18n";

import { AppShell } from "./app-shell";
import { AccessKeyRouteError } from "@/components/access-key-route-error";
import {
  DashboardRoutePage,
  LocaleLandingPage,
  ScheduleRoutePage,
  SettingsRoutePage,
  TaskDetailRoutePage,
  TaskListRoutePage,
} from "./pages";
import { NotFoundPage } from "@/components/not-found-page";
import {
  loadAppBootData,
  loadDashboardRouteData,
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
        // Inbox and Memory routes intentionally hidden. Dashboard owns concise
        // attention/recovery visibility; do not re-add standalone routes without
        // actionable controls and a clear product role.
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
