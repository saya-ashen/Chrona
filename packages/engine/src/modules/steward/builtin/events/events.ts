import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Caller = { kind: "module"; module: string; moduleId: string; hash: string } | { kind: string };
export type Subscription = { event: string; module: string; tool: string };
type Schema = { type?: string; required?: string[]; properties?: Record<string, { type?: string }> };
type Declared = { name: string; description?: string; payload?: Schema };
export type CallResult = { callId: string; status: "succeeded" | "failed" | "unknown"; error?: string };
type Ports = {
  dataDir: string;
  /** `modules.contributions` for section `events`. */
  contributions(): Promise<{ module: string; value: unknown }[]>;
  /** `modules.tools`: the targets this module may call (subscriber tools that name `events` in `callers`). */
  reachable(query: string): Promise<string[]>;
  call(target: string, args: Record<string, unknown>, options: { mode: "async"; key: string; reply: boolean }): Promise<{ callId: string }>;
};

const MAX_SUBSCRIBERS = 50, MAX_PAYLOAD = 64 * 1024;
const fail = (code: string, message: string) => Object.assign(new Error(`${code}: ${message}`), { code });

/** Subscriptions in one JSON file in the module's data directory, replaced atomically. */
function openStore(dataDir: string) {
  const file = join(dataDir, "subscriptions.json");
  let rows: Subscription[] = [];
  try { rows = JSON.parse(readFileSync(file, "utf8")) as Subscription[]; } catch { rows = []; }
  return {
    rows: () => rows,
    save(next: Subscription[]) { rows = next; writeFileSync(`${file}.tmp`, JSON.stringify(rows)); renameSync(`${file}.tmp`, file); },
  };
}
/** Enough of JSON Schema for declared payloads: an object, required keys, and the type of each declared property. */
function check(schema: Schema | undefined, value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw fail("invalid", "payload must be a JSON object");
  const data = value as Record<string, unknown>;
  for (const key of schema?.required ?? []) if (!(key in data)) throw fail("invalid", `payload.${key} is required`);
  for (const [key, property] of Object.entries(schema?.properties ?? {})) {
    if (!(key in data) || !property.type) continue;
    const actual = Array.isArray(data[key]) ? "array" : data[key] === null ? "null" : typeof data[key];
    const ok = property.type === actual || (property.type === "integer" && Number.isInteger(data[key]));
    if (!ok) throw fail("invalid", `payload.${key} must be ${property.type}`);
  }
}

/**
 * The `events` built-in module (v2-14): modules declare events in `contributes.events.emits`, others subscribe one of their
 * own tools (which names `events` in `callers`), and an emit is delivered to each subscriber as an async routed call.
 * Who emits and who subscribes is the caller Chrona recorded, never what the arguments claim.
 */
export function createEvents(ports: Ports) {
  const store = openStore(ports.dataDir), pending = new Map<string, Subscription>();
  async function declared(event: string) {
    for (const { module, value } of await ports.contributions()) {
      const emits = (value as { emits?: Declared[] } | null)?.emits ?? [];
      const found = Array.isArray(emits) ? emits.find(item => `${module}.${item.name}` === event) : undefined;
      if (found) return found;
    }
    return null;
  }
  function moduleOf(caller: Caller) {
    if (caller.kind !== "module" || !("module" in caller)) throw fail("forbidden", "Only a module may use events");
    return caller.module;
  }
  const same = (a: Subscription, b: Subscription) => a.event === b.event && a.module === b.module && a.tool === b.tool;
  return {
    async handle(id: string, args: Record<string, unknown>, caller: Caller) {
      const module = moduleOf(caller);
      if (id === "subscriptions") return { subscriptions: store.rows().filter(row => row.module === module) };
      const event = String(args.event ?? "");
      if (id === "unsubscribe") {
        const row = { event, module, tool: String(args.tool ?? "") };
        store.save(store.rows().filter(other => !same(other, row)));
        return { unsubscribed: true };
      }
      if (id === "subscribe") {
        if (!await declared(event)) throw fail("not_found", `No module declares the event ${event}`);
        const row = { event, module, tool: String(args.tool ?? "") }, target = `${module}.${row.tool}`;
        if (!(await ports.reachable(target)).includes(target)) throw fail("forbidden", `${target} must be your own tool and list "events" in callers`);
        if (!store.rows().some(other => same(other, row))) store.save([...store.rows(), row]);
        return { subscribed: true };
      }
      if (id === "emit") {
        const full = `${module}.${event}`, declaration = await declared(full);
        if (!declaration) throw fail("not_found", `${full} is not declared in contributes.events.emits`);
        const payload = String(args.payload ?? "");
        if (Buffer.byteLength(payload) > MAX_PAYLOAD) throw fail("invalid", "payload is larger than 64 KiB");
        let data: unknown;
        try { data = JSON.parse(payload); } catch { throw fail("invalid", "payload must be JSON"); }
        check(declaration.payload, data);
        const subscribers = store.rows().filter(row => row.event === full).slice(0, MAX_SUBSCRIBERS);
        for (const row of subscribers) {
          const reply = await ports.call(`${row.module}.${row.tool}`, { event: full, from: module, payload }, { mode: "async", key: `${full}:${String(args.key ?? "")}:${row.module}.${row.tool}`, reply: true });
          pending.set(reply.callId, row);
        }
        return { delivered: subscribers.length };
      }
      throw fail("not_found", `events.${id} not found`);
    },
    /** A delivery the subscriber can no longer take (removed, paused, its tool gone or no longer open to events) ends the subscription. */
    result(event: CallResult) {
      const row = pending.get(event.callId);
      pending.delete(event.callId);
      if (row && event.status === "failed" && /^(forbidden|not_found|unavailable)\b/.test(event.error ?? "")) store.save(store.rows().filter(other => !same(other, row)));
    },
  };
}
