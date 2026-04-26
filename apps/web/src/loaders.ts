import type { LoaderFunctionArgs, Params } from "react-router-dom";

import { getDictionary } from "@/i18n/get-dictionary";
import { resolveLocale, type Locale } from "@/i18n/config";

import { apiJson } from "./api";
import type {
  AppBootData,
  TaskPageRouteData,
  WorkPageRouteData,
  WorkspaceOverviewRouteData,
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

  const [schedule, inbox, memory, workspaces] = await Promise.all([
    apiJson<AppBootData["schedule"]>(`${origin}/api/schedule/projection?workspaceId=${encodeURIComponent(defaultWorkspace.id)}`),
    apiJson<AppBootData["inbox"]>(`${origin}/api/inbox/projection?workspaceId=${encodeURIComponent(defaultWorkspace.id)}`),
    apiJson<AppBootData["memory"]>(`${origin}/api/memory/projection?workspaceId=${encodeURIComponent(defaultWorkspace.id)}`),
    apiJson<AppBootData["workspaces"]>(`${origin}/api/workspaces`),
  ]);

  return {
    locale,
    dictionary,
    defaultWorkspace,
    schedule,
    inbox,
    memory,
    workspaces,
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
    task: await apiJson<TaskPageRouteData["task"]>(`${origin}/api/tasks/${params.taskId}/detail`),
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
      work: await apiJson<WorkPageRouteData["work"]>(`${origin}/api/work/${params.taskId}/projection`),
    };
  } catch (error) {
    if (error instanceof Response && error.status === 404) {
      throw error;
    }
    throw error;
  }
}

export async function loadWorkspaceOverviewData({
  params,
  request,
}: LoaderFunctionArgs): Promise<WorkspaceOverviewRouteData> {
  const locale = await resolveRouteLocale(params);
  const dictionary = await getDictionary(locale);
  const origin = getOrigin(request);

  if (!params.workspaceId) {
    throw new Response("Workspace id is required", { status: 400 });
  }

  return {
    locale,
    dictionary,
    workspaceId: params.workspaceId,
    data: await apiJson<WorkspaceOverviewRouteData["data"]>(`${origin}/api/workspaces/${params.workspaceId}/overview`),
  };
}
