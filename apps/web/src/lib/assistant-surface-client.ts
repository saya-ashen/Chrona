import type { AssistantActionRequest, AssistantActionResult, AssistantSurfaceState } from "@chrona/contracts";
import { buildAccessKeyHeaders, handleUnauthorizedResponse } from "@/lib/access-key";
import { postJson } from "@/lib/http-client";

async function getJson<T>(input: RequestInfo | URL): Promise<T> {
  const headers = buildAccessKeyHeaders();
  headers.set("content-type", "application/json");

  const response = await fetch(input, { headers });
  handleUnauthorizedResponse(response);
  if (!response.ok) throw new Error(response.statusText || "Request failed");
  return response.json() as Promise<T>;
}

export function fetchAssistantSurfaceState(params: { pageType: string; targetId?: string; workspaceId?: string }) {
  const query = new URLSearchParams();
  query.set("pageType", params.pageType);
  if (params.targetId) query.set("targetId", params.targetId);
  if (params.workspaceId) query.set("workspaceId", params.workspaceId);
  return getJson<AssistantSurfaceState>(`/api/assistant-surface?${query.toString()}`);
}

export function requestAssistantSurfaceAction(request: AssistantActionRequest) {
  return postJson<AssistantActionResult>("/api/assistant-surface/actions", request);
}
