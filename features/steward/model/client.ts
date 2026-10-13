import { z } from "zod";
import { apiJson } from "@shared/http";
import * as c from "@chrona/contracts/steward";

/** Auth is owned by apiJson; workspace scope is explicit on every request. */
export function createStewardClient(workspaceId: string) {
  async function request<S extends z.ZodType>(path: string, schema: S, options: { method?: string; body?: unknown; query?: Record<string, string | undefined>; signal?: AbortSignal } = {}): Promise<z.output<S>> {
    const query = new URLSearchParams({ workspaceId });
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) query.set(key, value);
    const payload = await apiJson<unknown>(`${c.STEWARD_API_BASE}${path}?${query}`, {
      method: options.method ?? "GET", signal: options.signal,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return schema.parse(payload);
  }
  const list = <S extends z.ZodType>(schema: S) => z.object({ items: z.array(schema) }).strict();
  const id = encodeURIComponent;
  return {
    today: (signal?: AbortSignal) => request("/today", c.todayViewSchema, { signal }),
    health: (signal?: AbortSignal) => request("/health", c.stewardHealthSchema, { signal }),
    affairs: (signal?: AbortSignal) => request("/affairs", list(c.affairSchema), { signal }),
    createAffair: (input: z.input<typeof c.createAffairSchema>) => request("/affairs", c.affairSchema, { method: "POST", body: c.createAffairSchema.parse(input) }),
    affair: (affairId: string, signal?: AbortSignal) => request(`/affairs/${id(affairId)}`, c.affairDetailSchema, { signal }),
    updateAffair: (affairId: string, input: z.input<typeof c.updateAffairSchema>) => request(`/affairs/${id(affairId)}`, c.affairSchema, { method: "PATCH", body: c.updateAffairSchema.parse(input) }),
    attention: (status?: c.AttentionStatus, signal?: AbortSignal) => request("/attention", list(c.attentionItemSchema), { query: { status }, signal }),
    decideAttention: (attentionId: string, input: z.input<typeof c.attentionDecisionSchema>) => request(`/attention/${id(attentionId)}/decision`, c.attentionItemSchema, { method: "POST", body: c.attentionDecisionSchema.parse(input) }),
    delegations: (signal?: AbortSignal) => request("/delegations", list(c.delegationSchema), { signal }),
    proposeDelegation: (input: z.input<typeof c.proposeDelegationSchema>) => request("/delegations", c.delegationSchema, { method: "POST", body: c.proposeDelegationSchema.parse(input) }),
    transitionDelegation: (delegationId: string, input: z.input<typeof c.delegationTransitionSchema>) => request(`/delegations/${id(delegationId)}/transition`, c.delegationSchema, { method: "POST", body: c.delegationTransitionSchema.parse(input) }),
    connections: (signal?: AbortSignal) => request("/connections", list(c.connectionSchema), { signal }),
    createConnection: (input: z.input<typeof c.createConnectionSchema>) => request("/connections", c.connectionSchema, { method: "POST", body: c.createConnectionSchema.parse(input) }),
    transitionConnection: (connectionId: string, input: z.input<typeof c.connectionTransitionSchema>) => request(`/connections/${id(connectionId)}/transition`, c.connectionSchema, { method: "POST", body: c.connectionTransitionSchema.parse(input) }),
    // The HTTP map specifies this response, but does not export a sync schema.
    syncConnection: (connectionId: string) => request(`/connections/${id(connectionId)}/sync`, z.object({ received: z.number().int().min(0), duplicates: z.number().int().min(0), baseline: z.boolean() }).strict(), { method: "POST" }),
    events: (query: { status?: c.EventStatus; connectionId?: string } = {}, signal?: AbortSignal) => request("/events", list(c.inboundEventSchema), { query, signal }),
    linkEvent: (eventId: string, input: z.input<typeof c.eventLinkSchema>) => request(`/events/${id(eventId)}/link`, c.inboundEventSchema, { method: "POST", body: c.eventLinkSchema.parse(input) }),
    notifications: (signal?: AbortSignal) => request("/notifications", list(c.notificationSchema), { signal }),
    acknowledgeNotification: (notificationId: string) => request(`/notifications/${id(notificationId)}/acknowledge`, c.notificationSchema, { method: "POST" }),
    tools: (signal?: AbortSignal) => request("/tools", list(c.managedToolSchema), { signal }),
    transitionTool: (toolId: string, input: z.input<typeof c.toolTransitionSchema>) => request(`/tools/${id(toolId)}/transition`, c.managedToolSchema, { method: "POST", body: c.toolTransitionSchema.parse(input) }),
    schedule: (query: { from?: string; to?: string } = {}, signal?: AbortSignal) => request("/schedule", list(c.scheduleItemSchema), { query, signal }),
  };
}
export type StewardClient = ReturnType<typeof createStewardClient>;
