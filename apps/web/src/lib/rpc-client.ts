/**
 * Hono RPC client — type-safe API calls derived from server routes.
 *
 * Uses hono/client's `hc` to infer request params, query, JSON body,
 * and response types from the server's Zod-validated routes.
 *
 * Usage:
 *   import { api } from "@/lib/rpc-client";
 *   const res = await api.tasks.$get({ query: { workspaceId } });
 *   // res is fully typed — no `as` cast needed.
 *
 */
import { hc } from "hono/client";
import type { ApiType } from "@chrona/server/routes";

export const api = hc<ApiType>("/api");

/** Re-export type for consumers that need the full AppType */
export type { ApiType } from "@chrona/server/routes";
