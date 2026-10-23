import { z } from "zod";
import { apiJson, buildAccessKeyHeaders, handleUnauthorizedResponse } from "@shared/http";
import * as c from "@chrona/contracts";

export type StewardErrorKey = "networkError" | "requestError" | "invalidResponse" | "invalidInput" | "unauthorized";
export class StewardClientError extends Error {
  constructor(public readonly messageKey: StewardErrorKey, public readonly status?: number, public readonly detail?: string) {
    super(messageKey); this.name = "StewardClientError";
  }
}
function badRequestDetail(status: number | undefined, data: unknown): string | undefined {
  return status === 400 && data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : undefined;
}

export function stewardError(error: unknown): StewardClientError {
  if (error instanceof StewardClientError) return error;
  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;
  const data = typeof error === "object" && error !== null && "data" in error ? error.data : null;
  const detail = badRequestDetail(status, data);
  return new StewardClientError(status === 401 ? "unauthorized" : status ? "requestError" : "networkError", status, detail);
}

async function rawAppFile(workspaceId: string, appId: string, path: string, signal?: AbortSignal): Promise<Blob> {
  if (!c.relativePathSchema.safeParse(path).success) throw new StewardClientError("invalidInput");
  const url = `${c.STEWARD_API_BASE}/apps/${encodeURIComponent(appId)}/raw?${new URLSearchParams({ workspaceId, path })}`;
  let response: Response;
  try { response = await fetch(url, { headers: buildAccessKeyHeaders(), signal, redirect: "error" }); }
  catch (error) { if (signal?.aborted) throw error; throw stewardError(error); }
  if (!response.ok) {
    handleUnauthorizedResponse(response);
    throw new StewardClientError(response.status === 401 ? "unauthorized" : "requestError", response.status);
  }
  return response.blob();
}

/** Auth remains in apiJson; every route has an explicit, encoded workspace scope. */
export function createStewardClient(workspaceId: string) {
  async function request<S extends z.ZodType>(path: string, schema: S, options: { method?: string; body?: unknown; query?: Record<string, string | undefined>; signal?: AbortSignal } = {}): Promise<z.output<S>> {
    const query = new URLSearchParams({ workspaceId });
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) query.set(key, value);
    let payload: unknown;
    try {
      payload = await apiJson<unknown>(`${c.STEWARD_API_BASE}${path}?${query}`, {
        method: options.method ?? "GET", signal: options.signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw stewardError(error);
    }
    const result = schema.safeParse(payload);
    if (!result.success) throw new StewardClientError("invalidResponse");
    return result.data;
  }
  const list = <S extends z.ZodType>(schema: S) => z.object({ items: z.array(schema) }).strict();
  const id = encodeURIComponent;
  async function mutate<I extends z.ZodType, O extends z.ZodType>(path: string, inputSchema: I, outputSchema: O, input: z.input<I>, method = "POST") {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new StewardClientError("invalidInput");
    return request(path, outputSchema, { method, body: parsed.data });
  }
  return {
    uiEvent: (appId: string, input: z.input<typeof c.uiEventSchema>) => mutate(`/apps/${id(appId)}/ui-event`, c.uiEventSchema, z.object({ ok: z.literal(true) }).strict(), input),
    today: (signal?: AbortSignal) => request("/today", c.todayViewSchema, { signal }),
    health: (signal?: AbortSignal) => request("/health", c.healthSchema, { signal }),
    providerRuns: (sessionId?: string, signal?: AbortSignal) => request("/provider/runs", list(c.providerRunViewSchema), { query: { sessionId }, signal }),
    answerProvider: (requestId: string, input: c.ProviderAnswer) => mutate(`/provider/interactions/${id(requestId)}/answer`, c.providerAnswerSchema, z.object({ ok: z.literal(true) }).strict(), input),
    cancelProviderRun: (runId: string) => request(`/provider/runs/${id(runId)}/cancel`, z.object({ ok: z.literal(true) }).strict(), { method: "POST" }),
    chat: (input: z.input<typeof c.chatInputSchema>) => mutate("/chat", c.chatInputSchema, c.chatReplySchema, input),
    sessions: (signal?: AbortSignal) => request("/sessions", list(c.sessionSchema), { query: { source: "web" }, signal }),
    newSession: (key: string) => mutate("/sessions/new", c.newSessionSchema, c.sessionSchema, { key }),
    session: (sessionId: string, signal?: AbortSignal) => request(`/sessions/${id(sessionId)}`, c.sessionSchema, { signal }),
    updateSession: (sessionId: string, input: z.input<typeof c.updateSessionSchema>) => mutate(`/sessions/${id(sessionId)}`, c.updateSessionSchema, c.sessionSchema, input, "PATCH"),
    chatMessages: (sessionId: string, signal?: AbortSignal) => request(`/sessions/${id(sessionId)}/messages`, list(c.messageSchema), { signal }),
    apps: (signal?: AbortSignal) => request("/apps", list(c.appSchema), { signal }),
    tree: (appId: string, signal?: AbortSignal) => request(`/apps/${id(appId)}/tree`, list(c.fileNodeSchema), { signal }),
    file: (appId: string, path: string, signal?: AbortSignal) => request(`/apps/${id(appId)}/file`, c.fileContentSchema, { query: { path }, signal }),
    upload: async (appId: string, file: File, dir?: string) => {
      if (dir !== undefined && !c.relativePathSchema.safeParse(dir).success) throw new StewardClientError("invalidInput");
      const form = new FormData();
      form.set("file", file);
      if (dir !== undefined) form.set("dir", dir);
      let response: Response;
      try {
        response = await fetch(`${c.STEWARD_API_BASE}/apps/${id(appId)}/upload?${new URLSearchParams({ workspaceId })}`, { method: "POST", headers: buildAccessKeyHeaders(), body: form });
      } catch (error) { throw stewardError(error); }
      if (!response.ok) {
        handleUnauthorizedResponse(response);
        throw new StewardClientError(response.status === 401 ? "unauthorized" : "requestError", response.status);
      }
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new StewardClientError("invalidResponse"); }
      const parsed = c.fileNodeSchema.safeParse(payload);
      if (!parsed.success) throw new StewardClientError("invalidResponse");
      return parsed.data;
    },
    raw: (appId: string, path: string, signal?: AbortSignal) => rawAppFile(workspaceId, appId, path, signal),
    saveFile: (appId: string, input: z.input<typeof c.saveFileSchema>) => mutate(`/apps/${id(appId)}/file`, c.saveFileSchema, c.fileContentSchema, input, "PUT"),
    toggleCheckbox: (appId: string, input: z.input<typeof c.toggleCheckboxSchema>) => mutate(`/apps/${id(appId)}/checkbox`, c.toggleCheckboxSchema, c.fileContentSchema, input),
    addPanelEntry: (appId: string, input: z.input<typeof c.panelEntrySchema>) => mutate(`/apps/${id(appId)}/panel-entry`, c.panelEntrySchema, c.fileContentSchema, input),
    schedules: (signal?: AbortSignal) => request("/schedules", list(c.scheduleSchema), { signal }),
    updateSchedule: (scheduleId: string, input: z.input<typeof c.updateScheduleSchema>) => mutate(`/schedules/${id(scheduleId)}`, c.updateScheduleSchema, c.scheduleSchema, input, "PATCH"),
    approvals: (status?: c.Approval["status"], signal?: AbortSignal) => request("/approvals", list(c.approvalSchema), { query: { status }, signal }),
    resolveApproval: (approvalId: string, input: z.input<typeof c.resolveApprovalSchema>) => mutate(`/approvals/${id(approvalId)}/resolve`, c.resolveApprovalSchema, c.approvalSchema, input),
    settings: (signal?: AbortSignal) => request("/settings", c.settingsSchema, { signal }),
    updateSettings: (input: z.input<typeof c.updateSettingsSchema>) => mutate("/settings", c.updateSettingsSchema, c.settingsSchema, input, "PATCH"),
    grants: (signal?: AbortSignal) => request("/grants", list(c.grantSchema), { signal }),
    createGrant: (input: z.input<typeof c.createGrantSchema>) => mutate("/grants", c.createGrantSchema, c.grantSchema, input),
    revokeGrant: (grantId: string) => request(`/grants/${id(grantId)}/revoke`, c.grantSchema, { method: "POST" }),
    preferences: (signal?: AbortSignal) => request("/preferences", list(c.preferenceSchema), { signal }),
    createPreference: (input: z.input<typeof c.createPreferenceSchema>) => mutate("/preferences", c.createPreferenceSchema, c.preferenceSchema, input),
    deletePreference: (preferenceId: string) => request(`/preferences/${id(preferenceId)}`, z.null(), { method: "DELETE" }),
    notifications: (signal?: AbortSignal) => request("/notifications", list(c.notificationSchema), { signal }),
    notificationFeedback: (notificationId: string, input: { feedback: "useful" | "not_useful" }) => mutate(`/notifications/${id(notificationId)}/feedback`, z.object({ feedback: z.enum(["useful", "not_useful"]) }).strict(), c.notificationSchema, input),
    retryNotification: (notificationId: string) => request(`/notifications/${id(notificationId)}/retry`, c.notificationSchema, { method: "POST" }),
    connectors: (signal?: AbortSignal) => request("/connectors", list(c.connectorSchema), { signal }),
    createConnector: (input: z.input<typeof c.createConnectorSchema>) => mutate("/connectors", c.createConnectorSchema, c.connectorSchema, input),
    updateConnector: (connectorId: string, input: z.input<typeof c.updateConnectorSchema>) => mutate(`/connectors/${id(connectorId)}`, c.updateConnectorSchema, c.connectorSchema, input, "PATCH"),
    testConnector: (connectorId: string) => request(`/connectors/${id(connectorId)}/test`, z.discriminatedUnion("ok", [z.object({ ok: z.literal(true) }).strict(), z.object({ ok: z.literal(false), error: z.string() }).strict()]), { method: "POST" }),
    syncConnector: (connectorId: string) => request(`/connectors/${id(connectorId)}/sync`, c.connectorSchema, { method: "POST" }),
    connectorItems: (connectorId: string, signal?: AbortSignal) => request(`/connectors/${id(connectorId)}/items`, list(c.inboundItemSchema), { signal }),
  };
}
export type StewardClient = ReturnType<typeof createStewardClient>;
