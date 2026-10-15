import { z } from "zod";
import { apiJson } from "@shared/http";
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
    today: (signal?: AbortSignal) => request("/today", c.todayViewSchema, { signal }),
    health: (signal?: AbortSignal) => request("/health", c.healthSchema, { signal }),
    chat: (input: z.input<typeof c.chatInputSchema>) => mutate("/chat", c.chatInputSchema, c.chatReplySchema, input),
    chatMessages: (limit?: number, signal?: AbortSignal) => request("/chat/messages", list(c.chatMessageSchema), { query: { limit: limit?.toString() }, signal }),
    affairs: (status?: c.AffairStatus, signal?: AbortSignal) => request("/affairs", list(c.affairSchema), { query: { status }, signal }),
    createAffair: (input: z.input<typeof c.createAffairSchema>) => mutate("/affairs", c.createAffairSchema, c.affairSchema, input),
    affair: (affairId: string, signal?: AbortSignal) => request(`/affairs/${id(affairId)}`, c.affairDetailSchema, { signal }),
    updateAffair: (affairId: string, input: z.input<typeof c.updateAffairSchema>) => mutate(`/affairs/${id(affairId)}`, c.updateAffairSchema, c.affairSchema, input, "PATCH"),
    addEntry: (affairId: string, input: z.input<typeof c.addEntrySchema>) => mutate(`/affairs/${id(affairId)}/entries`, c.addEntrySchema, c.entrySchema, input),
    result: (affairId: string, version: number, signal?: AbortSignal) => request(`/affairs/${id(affairId)}/results/${id(String(version))}`, c.resultSchema, { signal }),
    resolveAsk: (askId: string, input: z.input<typeof c.resolveAskSchema>) => mutate(`/asks/${id(askId)}/resolve`, c.resolveAskSchema, c.askSchema, input),
    settings: (signal?: AbortSignal) => request("/settings", c.settingsSchema, { signal }),
    updateSettings: (input: z.input<typeof c.updateSettingsSchema>) => mutate("/settings", c.updateSettingsSchema, c.settingsSchema, input, "PATCH"),
    grants: (signal?: AbortSignal) => request("/grants", list(c.grantSchema), { signal }),
    createGrant: (input: z.input<typeof c.createGrantSchema>) => mutate("/grants", c.createGrantSchema, c.grantSchema, input),
    revokeGrant: (grantId: string) => request(`/grants/${id(grantId)}/revoke`, c.grantSchema, { method: "POST" }),
    preferences: (signal?: AbortSignal) => request("/preferences", list(c.preferenceSchema), { signal }),
    createPreference: (input: z.input<typeof c.createPreferenceSchema>) => mutate("/preferences", c.createPreferenceSchema, c.preferenceSchema, input),
    deletePreference: (preferenceId: string) => request(`/preferences/${id(preferenceId)}`, z.null(), { method: "DELETE" }),
    notifications: (signal?: AbortSignal) => request("/notifications", list(c.notificationSchema), { signal }),
    notificationFeedback: (notificationId: string, input: z.input<typeof c.notificationFeedbackSchema>) => mutate(`/notifications/${id(notificationId)}/feedback`, c.notificationFeedbackSchema, c.notificationSchema, input),
    retryNotification: (notificationId: string) => request(`/notifications/${id(notificationId)}/retry`, c.notificationSchema, { method: "POST" }),
    connections: (signal?: AbortSignal) => request("/connections", list(c.connectionSchema), { signal }),
    createConnection: (input: z.input<typeof c.createConnectionSchema>) => mutate("/connections", c.createConnectionSchema, c.connectionSchema, input),
    transitionConnection: (connectionId: string, input: z.input<typeof c.connectionTransitionSchema>) => mutate(`/connections/${id(connectionId)}/transition`, c.connectionTransitionSchema, c.connectionSchema, input),
    syncConnection: (connectionId: string) => request(`/connections/${id(connectionId)}/sync`, c.connectionSchema, { method: "POST" }),
    tools: (signal?: AbortSignal) => request("/tools", list(c.toolSchema), { signal }),
    tool: (toolId: string, signal?: AbortSignal) => request(`/tools/${id(toolId)}`, c.toolDetailSchema, { signal }),
    addPanelEntry: (toolId: string, input: z.input<typeof c.addPanelEntrySchema>) => mutate(`/tools/${id(toolId)}/entries`, c.addPanelEntrySchema, c.panelEntrySchema, input),
    deletePanelEntry: (toolId: string, entryId: string) => request(`/tools/${id(toolId)}/entries/${id(entryId)}`, z.null(), { method: "DELETE" }),
    transitionTool: (toolId: string, input: z.input<typeof c.toolTransitionSchema>) => mutate(`/tools/${id(toolId)}/transition`, c.toolTransitionSchema, c.toolSchema, input),
  };
}
export type StewardClient = ReturnType<typeof createStewardClient>;
