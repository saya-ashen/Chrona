/**
 * Browser-safe Hono RPC client factory.
 *
 * The route type remains owned by each product feature or composition root;
 * shared HTTP only owns authenticated client transport.
 */
import type { Hono } from "hono";
import { hc } from "hono/client";

import { buildAccessKeyHeaders, handleUnauthorizedResponse } from "./access-key";

export function createRpcClient<Router extends Hono>(baseUrl = "/api") {
  return hc<Router>(baseUrl, {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(input, {
        ...init,
        headers: buildAccessKeyHeaders(init?.headers),
      });
      handleUnauthorizedResponse(response);
      return response;
    },
  });
}
