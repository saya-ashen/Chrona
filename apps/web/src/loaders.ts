import type { LoaderFunctionArgs, Params } from "react-router-dom";

import { getDictionary } from "@/i18n/get-dictionary";
import { resolveLocale, type Locale } from "@/i18n/config";

import { apiJson } from "./api";
import type {
  AppBootData,
  TaskListRouteData,
  TaskPageRouteData,
  WorkbenchHubRouteData,
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

  const [schedule, inbox, memory] = await Promise.all([
    apiJson<AppBootData["schedule"]>(`${origin}/api/schedule?workspaceId=${encodeURIComponent(defaultWorkspace.id)}`),
    apiJson<AppBootData["inbox"]>(`${origin}/api/inbox?workspaceId=${encodeURIComponent(defaultWorkspace.id)}`),
    apiJson<AppBootData["memory"]>(`${origin}/api/memory?workspaceId=${encodeURIComponent(defaultWorkspace.id)}`),
  ]);

  return {
    locale,
    dictionary,
    defaultWorkspace,
    schedule,
    inbox,
    memory,
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

export async function loadWorkbenchHubData({ params, request }: LoaderFunctionArgs): Promise<WorkbenchHubRouteData> {
  const locale = await resolveRouteLocale(params);
  const dictionary = await getDictionary(locale);
  const origin = getOrigin(request);

  const workspace = await apiJson<{ id: string }>(
    `${origin}/api/workspaces/default`,
  );
  const workspaceId = workspace.id;

  const result = await apiJson<{ tasks: WorkbenchHubRouteData["tasks"]; count: number }>(
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

  try {
    return {
      locale,
      dictionary,
      work: await apiJson<WorkPageRouteData["work"]>(`${origin}/api/work/${params.taskId}`),
    };
  } catch (error) {
    if (error instanceof Response && error.status === 404) {
      throw error;
    }
    throw error;
  }
}
