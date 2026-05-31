import type { LoaderFunctionArgs, Params } from "react-router-dom";

import { getDictionary, resolveLocale, type Locale } from "@chrona/i18n";

import { apiJson } from "./api";
import type {
  AppBootData,
  InboxRouteData,
  MemoryRouteData,
  ScheduleRouteData,
  TaskListRouteData,
  TaskPageRouteData,
  WorkPageRouteData,
} from "./pages";

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

export async function loadInboxRouteData({ request }: LoaderFunctionArgs): Promise<InboxRouteData> {
  const origin = getOrigin(request);
  const defaultWorkspace = await apiJson<AppBootData["defaultWorkspace"]>(`${origin}/api/workspaces/default`);

  return {
    inbox: await apiJson<InboxRouteData["inbox"]>(
      `${origin}/api/inbox?workspaceId=${encodeURIComponent(defaultWorkspace.id)}`,
    ),
  };
}

export async function loadMemoryRouteData({ request }: LoaderFunctionArgs): Promise<MemoryRouteData> {
  const origin = getOrigin(request);
  const defaultWorkspace = await apiJson<AppBootData["defaultWorkspace"]>(`${origin}/api/workspaces/default`);

  return {
    memory: await apiJson<MemoryRouteData["memory"]>(
      `${origin}/api/memory?workspaceId=${encodeURIComponent(defaultWorkspace.id)}`,
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

  const result = await apiJson<{ tasks: TaskListRouteData["tasks"]; count: number }>(
    `${origin}/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}&limit=200`,
  );

  return {
    locale,
    dictionary,
    tasks: result.tasks,
    workspaceId,
  };
}

export async function loadTaskPageData({ params, request }: LoaderFunctionArgs): Promise<TaskPageRouteData> {
  const locale = await resolveRouteLocale(params);
  const dictionary = await getDictionary(locale);
  const origin = getOrigin(request);

  if (!params.taskId) {
    throw new Response("Task id is required", { status: 400 });
  }

  return {
    locale,
    dictionary,
    task: await apiJson<TaskPageRouteData["task"]>(`${origin}/api/tasks/${params.taskId}`),
  };
}

export async function loadWorkPageData({ params, request }: LoaderFunctionArgs): Promise<WorkPageRouteData> {
  const locale = await resolveRouteLocale(params);
  const dictionary = await getDictionary(locale);
  const origin = getOrigin(request);

  if (!params.taskId) {
    throw new Response("Task id is required", { status: 400 });
  }

  return {
    locale,
    dictionary,
    work: await apiJson<WorkPageRouteData["work"]>(`${origin}/api/work/${params.taskId}`),
  };
}
