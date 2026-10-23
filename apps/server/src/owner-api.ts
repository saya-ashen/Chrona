import type { StewardPorts, StewardService } from "@chrona/engine";
import { createStewardRoutes } from "./routes/steward.routes";
import { readEnv } from "./config/env";

/** The owner API for entry modules: one request of the /api/steward map, in process, as the user. */
export function ownerApi(ports: StewardPorts, service: StewardService, wake: () => void): NonNullable<StewardPorts["owner"]> {
  let routes: ReturnType<typeof createStewardRoutes> | undefined;
  return async (workspaceId, { method, path, body }) => {
    routes ??= createStewardRoutes(ports, service, wake);
    const url = new URL(path, "http://owner");
    url.searchParams.set("workspaceId", workspaceId);
    const key = readEnv().API_KEY, headers = new Headers(key ? { authorization: `Bearer ${key}` } : {});
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await routes.request(url.pathname + url.search, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const contentType = response.headers.get("content-type") ?? "";
    // Downloads (e.g. /apps/:id/raw) come back as base64; the module channel caps lines at 32 MiB.
    if (!contentType.includes("json") && response.ok && response.status !== 204) {
      const bytes = Buffer.from(await response.arrayBuffer());
      return bytes.byteLength > 20 * 1024 * 1024 ? { status: 413, body: { code: "TOO_LARGE" } } : { status: response.status, body: { contentType, base64: bytes.toString("base64") } };
    }
    const text = await response.text();
    if (text.length > 30 * 1024 * 1024) return { status: 413, body: { code: "TOO_LARGE" } };
    try { return { status: response.status, body: text ? JSON.parse(text) : null }; }
    catch { return { status: response.status, body: null }; }
  };
}
