import { z } from "zod";
import type { SourceAdapter, SourceItem } from "@chrona/contracts/steward";

const iso = z.string().datetime({ offset: true }).max(40);
const serviceSchema = z.object({
  id: z.string().min(1).max(64), name: z.string().min(1).max(120),
  category: z.string().max(120),
  status: z.enum(["online", "reachable", "offline", "unhealthy", "unknown"]),
  httpStatus: z.number().int().min(100).max(599).nullable(), checkedAt: iso.nullable(),
});
// Zod objects strip unknown fields at every level; dashboard details never leave this boundary.
const dashboardSchema = z.object({
  version: z.literal(1), overallState: z.enum(["collecting", "stale", "attention", "normal"]),
  services: z.array(serviceSchema),
  network: z.object({ state: z.enum(["healthy", "degraded", "down", "unknown"]), stale: z.boolean(), checkedAt: iso.nullable() }),
});
const entrySchema = z.object({ cls: z.enum(["ok", "attention"]), since: iso });
const cursorSchema = z.object({
  v: z.literal(1),
  // Parse entries individually: record parsing may discard an id such as "__proto__".
  services: z.preprocess(
    value => value !== null && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : undefined,
    z.array(z.tuple([z.string().min(1).max(64), entrySchema])).transform(entries => Object.fromEntries(entries)),
  ),
  network: entrySchema.nullable(),
});
type Entry = z.infer<typeof entrySchema>;
type Cursor = z.infer<typeof cursorSchema>;
const MAX_BYTES = 512 * 1024;

function readCursor(value: string | null): Cursor | null {
  try { return value === null ? null : cursorSchema.parse(JSON.parse(value)); }
  catch { return null; }
}

function configuredUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

async function readDashboard(response: Response) {
  if (response.status !== 200 || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
    || Number(response.headers.get("content-length")) > MAX_BYTES || !response.body) throw new Error("Invalid Chino dashboard response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Chino dashboard response too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return dashboardSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}

type Dashboard = z.infer<typeof dashboardSchema>;
type Subject = { key: string; old: Entry | undefined; cls: Entry["cls"]; checkedAt: string; item: Omit<SourceItem, "externalId" | "occurredAt"> };

function serviceSubject(service: Dashboard["services"][number], old: Entry | undefined): Subject | null {
  if (service.status === "unknown" || service.checkedAt === null) return null;
  const cls = service.status === "online" || service.status === "reachable" ? "ok" : "attention";
  return { key: `service:${service.id}`, old, cls, checkedAt: service.checkedAt, item: {
    threadId: `chino-service:${service.id}`, author: "chino-dashboard", url: null,
    title: `Chino 服务 ${service.name} ${cls === "attention" ? "不可用" : "已恢复"}（${service.status}）`,
    body: `服务 ID: ${service.id}\n名称: ${service.name}\n分类: ${service.category}\n状态: ${old?.cls ?? "未观测"} -> ${service.status}\nHTTP 状态: ${service.httpStatus ?? "无"}\n检查时间: ${service.checkedAt}`,
  } };
}

function networkSubject(network: Dashboard["network"], old: Entry | undefined): Subject | null {
  if (network.stale || network.state === "unknown" || network.checkedAt === null) return null;
  const cls = network.state === "healthy" ? "ok" : "attention";
  return { key: "network", old, cls, checkedAt: network.checkedAt, item: {
    threadId: "chino-network", author: "chino-dashboard", url: null,
    title: `Chino 网络${cls === "attention" ? "状态异常" : "已恢复"}（${network.state}）`,
    body: `状态: ${old?.cls ?? "未观测"} -> ${network.state}\n检查时间: ${network.checkedAt}`,
  } };
}

/** Turns one dashboard reading into state-change items and the cursor that remembers it. */
function changes(dashboard: Dashboard, previous: Cursor | null): { items: SourceItem[]; nextCursor: string | null } {
  if (dashboard.overallState === "collecting") return { items: [], nextCursor: previous ? JSON.stringify(previous) : null };
  const items: SourceItem[] = [];
  // Returns the entry to remember. A deferred change keeps the old entry so a later poll still reports it.
  function observe(subject: Subject | null, old: Entry | undefined): Entry | undefined {
    if (!subject || old?.cls === subject.cls) return old;
    if (old || subject.cls === "attention") {
      if (items.length === 50) return old;
      // With no previous cursor this is the first sync: what is wrong now is a live condition, not history.
      items.push({ ...subject.item, externalId: `${subject.key}:${subject.cls}:${subject.checkedAt}`, occurredAt: subject.checkedAt, ...(previous ? {} : { current: true }) });
    }
    return { cls: subject.cls, since: subject.checkedAt };
  }
  const services: Cursor["services"] = Object.create(null) as Cursor["services"];
  const ids = new Set<string>();
  for (const service of dashboard.services) {
    if (ids.has(service.id)) throw new Error("Duplicate Chino service id");
    ids.add(service.id);
    const old = previous && Object.hasOwn(previous.services, service.id) ? previous.services[service.id] : undefined;
    const entry = observe(serviceSubject(service, old), old);
    if (entry) services[service.id] = entry;
  }
  const oldNetwork = previous?.network ?? undefined;
  const network = observe(networkSubject(dashboard.network, oldNetwork), oldNetwork) ?? null;
  return { items, nextCursor: JSON.stringify({ v: 1, services, network } satisfies Cursor) };
}

/** Read-only host-local summary polling. Connection config cannot override the host-owned URL. */
export function createChinoServiceHealthSource(options: { url?: string; fetch?: (url: string, init: RequestInit) => Promise<Response>; timeoutMs?: number } = {}): SourceAdapter {
  const url = configuredUrl(options.url);
  const reason = !options.url ? "Chino dashboard URL is not configured on this host" : "Chino dashboard URL must be credential-free HTTP on loopback";
  return {
    kind: "chino_service_health", mode: "poll", supportedActions: ["read_source"],
    coverageNote: "Polls the Chino dashboard summary; only state changes seen between polls are recorded, short outages between polls are missed, and service details are not read. At most 50 changes per poll; excess changes are deferred.",
    async readiness() { return url ? { state: "ready" } : { state: "unsupported", reason }; },
    async poll(_connection, cursor) {
      if (!url) throw new Error(reason);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
      try {
        const response = await (options.fetch ?? globalThis.fetch)(url, {
          method: "GET", redirect: "error", credentials: "omit", headers: { Accept: "application/json" }, signal: controller.signal,
        });
        return changes(await readDashboard(response), readCursor(cursor));
      } catch { throw new Error("Chino dashboard poll failed"); }
      finally { clearTimeout(timer); controller.abort(); }
    },
  };
}
