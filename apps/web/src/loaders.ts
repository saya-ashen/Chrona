import type { LoaderFunctionArgs, Params } from "react-router-dom";

import { getDictionary, resolveLocale, type Locale } from "@chrona/i18n";

import { apiJson } from "../../../shared/http/api-client";
import type {
  AppBootData,
  ActionCenterRouteData,
  DashboardRouteData,
  ScheduleRouteData,
  TaskListRouteData,
  TaskPageRouteData,
} from "./pages";
import type {
  TaskWorkspaceBootstrapData,
  TaskWorkspaceCommandCenterData,
  TaskWorkspaceHeaderData,
  TaskWorkspaceReviewContextData,
  TaskWorkspaceRuntimeContextData,
} from "@features/task-workspace";

async function resolveRouteLocale(params: Params<string>): Promise<Locale> {
  return resolveLocale(params.lang);
}

function getOrigin(request: Request) {
  return new URL(request.url).origin;
}

export async function loadAppBootData({ params, request }: LoaderFunctionArgs): Promise<AppBootData> {
  const locale = await resolveRouteLocale(params);
  const dictionary = await getDictionary(locale);
  const origin = getOrigin(request);

  const defaultWorkspace = await apiJson<AppBootData["defaultWorkspace"]>(`${origin}/api/workspaces/default`);

  return {
    locale,
    dictionary,
    defaultWorkspace,
  };
}

export async function loadScheduleRouteData({ request }: LoaderFunctionArgs): Promise<ScheduleRouteData> {
  const origin = getOrigin(request);
  const defaultWorkspace = await apiJson<AppBootData["defaultWorkspace"]>(`${origin}/api/workspaces/default`);

  return {
    schedule: await apiJson<ScheduleRouteData["schedule"]>(
      `${origin}/api/schedule?workspaceId=${encodeURIComponent(defaultWorkspace.id)}`,
    ),
  };
}


export async function loadDashboardRouteData({ request }: LoaderFunctionArgs): Promise<DashboardRouteData> {
  const origin = getOrigin(request);
  const defaultWorkspace = await apiJson<AppBootData["defaultWorkspace"]>(`${origin}/api/workspaces/default`);

  return {
    dashboard: await apiJson<DashboardRouteData["dashboard"]>(
      `${origin}/api/dashboard?workspaceId=${encodeURIComponent(defaultWorkspace.id)}`,
    ),
  };
}

export async function loadActionCenterRouteData({ request }: LoaderFunctionArgs): Promise<ActionCenterRouteData> {
  const origin = getOrigin(request);
  const defaultWorkspace = await apiJson<AppBootData["defaultWorkspace"]>(`${origin}/api/workspaces/default`);

  return {
    actionCenter: await apiJson<ActionCenterRouteData["actionCenter"]>(
      `${origin}/api/inbox?workspaceId=${encodeURIComponent(defaultWorkspace.id)}`,
    ),
  };
}


export async function loadTaskListData({ params, request }: LoaderFunctionArgs): Promise<TaskListRouteData> {
  const locale = await resolveRouteLocale(params);
  const dictionary = await getDictionary(locale);
  const origin = getOrigin(request);

  const workspace = await apiJson<TaskListRouteData["workspaceId"] & { id: string }>(
    `${origin}/api/workspaces/default`,
  );
  const workspaceId = workspace.id;

  const requestUrl = new URL(request.url);
  const query = new URLSearchParams({ workspaceId });
  for (const key of ["filter", "priority", "search", "sort", "order", "page", "pageSize", "view", "resultDate"] as const) {
    const value = requestUrl.searchParams.get(key);
    if (value) query.set(key, value);
  }

  const result = await apiJson<{
    tasks: TaskListRouteData["tasks"];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
    counts: TaskListRouteData["counts"];
  }>(`${origin}/api/tasks?${query.toString()}`);

  return {
    locale,
    dictionary,
    tasks: result.tasks,
    workspaceId,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    pageCount: result.pageCount,
    counts: result.counts,
  };
}

export async function loadTaskPageData({ params, request }: LoaderFunctionArgs): Promise<TaskPageRouteData> {
  const locale = await resolveRouteLocale(params);
  const dictionary = await getDictionary(locale);
  const origin = getOrigin(request);

  if (!params.taskId) {
    throw new Response("Task id is required", { status: 400 });
  }

  const requestUrl = new URL(request.url);
  const query = new URLSearchParams();
  const workBlockId = requestUrl.searchParams.get("workBlockId");
  if (workBlockId) query.set("workBlockId", workBlockId);
  const suffix = query.size ? `?${query.toString()}` : "";

  const taskPath = `${origin}/api/tasks/${params.taskId}`;
  const [bootstrap, runtimeContext, reviewContext, commandCenter, header] = await Promise.all([
    apiJson<TaskWorkspaceBootstrapData>(`${taskPath}${suffix}`),
    apiJson<TaskWorkspaceRuntimeContextData>(`${taskPath}/runtime-context${suffix}`),
    apiJson<TaskWorkspaceReviewContextData>(`${taskPath}/review-context${suffix}`),
    apiJson<TaskWorkspaceCommandCenterData>(`${taskPath}/command-center${suffix}`),
    apiJson<TaskWorkspaceHeaderData>(`${taskPath}/workspace/header${suffix}`),
  ]);

  return {
    locale,
    dictionary,
    task: {
      ...bootstrap,
      ...runtimeContext,
      ...reviewContext,
      artifacts: [],
      activityTimeline: [],
      commandCenter,
      header,
    } as TaskPageRouteData["task"],
  };
}

