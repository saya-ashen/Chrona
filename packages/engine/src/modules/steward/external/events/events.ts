import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export type Caller = { kind: "module"; module: string; moduleId: string; hash: string } | { kind: string };
export type Subscription = { event: string; module: string; tool: string; moduleId: string; publisherId: string; contractHash: string; revision: string; invalid?: boolean };
export type Directory = { modules: { id: string; name: string; status: string; activeHash: string | null }[]; tools: { target: string; moduleId?: string; hash?: string; contractHash?: string; inputSchema: Record<string, unknown> }[] };
type Schema = { type?: string; required?: string[]; properties?: Record<string, { type?: string }> };
type Declared = { name: string; description?: string; payload?: Schema };
export type CallResult = { callId: string; status: "succeeded" | "failed" | "unknown"; error?: string };
type Ports = {
  dataDir: string;
  /** `modules.contributions` for section `events`. */
  contributions(): Promise<{ module: string; value: unknown }[]>;
  /** Complete module identities and tools reachable by events. */
  directory(): Promise<Directory>;
  call(target: string, args: Record<string, unknown>, options: { mode: "async"; key: string; reply: boolean; expectedTarget: { moduleId: string; contractHash: string } }): Promise<{ callId: string; duplicate?: boolean }>;
};

const MAX_SUBSCRIBERS = 50, MAX_PAYLOAD = 64 * 1024;
const fail = (code: string, message: string) => Object.assign(new Error(`${code}: ${message}`), { code });

/** Subscriptions in one JSON file in the module's data directory, replaced atomically. */
function openStore(dataDir: string) {
  const file = join(dataDir, "subscriptions.json");
  let rows: Subscription[] = [];
  try { rows = JSON.parse(readFileSync(file, "utf8")) as Subscription[]; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!Array.isArray(rows)) throw new Error("Invalid subscriptions store");
  return {
    rows: () => rows,
    save(next: Subscription[]) { rows = next; writeFileSync(`${file}.tmp`, JSON.stringify(rows)); renameSync(`${file}.tmp`, file); },
  };
}
/** Enough of JSON Schema for declared payloads: an object, required keys, and the type of each declared property. */
function checkRequired(schema: Schema | undefined, data: Record<string, unknown>) {
  for (const key of schema?.required ?? []) if (!(key in data)) throw fail("invalid", `payload.${key} is required`);
}
function checkProperties(schema: Schema | undefined, data: Record<string, unknown>) {
  for (const [key, property] of Object.entries(schema?.properties ?? {})) {
    if (!(key in data) || !property.type) continue;
    const actual = Array.isArray(data[key]) ? "array" : data[key] === null ? "null" : typeof data[key];
    const ok = property.type === actual || (property.type === "integer" && Number.isInteger(data[key]));
    if (!ok) throw fail("invalid", `payload.${key} must be ${property.type}`);
  }
}
function check(schema: Schema | undefined, value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw fail("invalid", "payload must be a JSON object");
  const data = value as Record<string, unknown>;
  checkRequired(schema, data);
  checkProperties(schema, data);
}

const same = (a: Subscription, b: Subscription) => a.event === b.event && a.moduleId === b.moduleId && a.tool === b.tool;
function compatible(candidate: Directory["tools"][number] | undefined) {
  const schema = candidate?.inputSchema, properties = schema?.properties as Record<string, { type?: string; enum?: unknown }> | undefined;
  return candidate?.contractHash && schema?.type === "object" && ["event", "from", "payload"].every(key => properties?.[key]?.type === "string" && !properties[key]!.enum)
    && (schema.required as string[] | undefined ?? []).every(key => ["event", "from", "payload"].includes(key));
}
function loadPending(file: string): Partial<Record<string, Subscription>> {
  let value: unknown = {};
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid event delivery receipts");
  return value as Partial<Record<string, Subscription>>;
}

/**
 * The `events` built-in module (v2-14): modules declare events in `contributes.events.emits`, others subscribe one of their
 * own tools (visible to modules), and an emit is delivered to each subscriber as an async routed call.
 * Who emits and who subscribes is the caller Chrona recorded, never what the arguments claim.
 */
export function createEvents(ports: Ports) {
  const store = openStore(ports.dataDir), pendingFile = join(ports.dataDir, "deliveries.json");
  const pending = loadPending(pendingFile);
  const savePending = () => { writeFileSync(`${pendingFile}.tmp`, JSON.stringify(pending)); renameSync(`${pendingFile}.tmp`, pendingFile); };
  let directory: Directory = { modules: [], tools: [] };
  const owner = (id: string, name: string) => directory.modules.find(module => module.id === id && module.name === name);
  const reference = (moduleId: string, module: string, tool: string) => {
    const current = owner(moduleId, module);
    return current?.status === "active" && current.activeHash ? directory.tools.find(candidate => candidate.moduleId === moduleId && candidate.hash === current.activeHash && candidate.target === `${module}.${tool}`) : undefined;
  };

  async function refresh() {
    const current = await ports.directory();
    if (!Array.isArray(current.modules) || !Array.isArray(current.tools)) throw fail("unavailable", "Module directory unavailable");
    directory = current;
    const rows = store.rows().filter(row => row.moduleId && row.publisherId && owner(row.moduleId, row.module) && directory.modules.some(module => module.id === row.publisherId && row.event.startsWith(`${module.name}.`)));
    const checked = rows.map(row => {
      const current = owner(row.moduleId, row.module), callback = reference(row.moduleId, row.module, row.tool);
      return current?.status === "active" && (!compatible(callback) || callback!.contractHash !== row.contractHash) ? { ...row, invalid: true } : row;
    });
    if (JSON.stringify(checked) !== JSON.stringify(store.rows())) store.save(checked);
  }
  async function declared(event: string) {
    for (const { module, value } of await ports.contributions()) {
      const emits = (value as { emits?: Declared[] } | null)?.emits ?? [];
      const found = Array.isArray(emits) ? emits.find(item => `${module}.${item.name}` === event) : undefined;
      if (found) return found;
    }
    return null;
  }
  function moduleOf(caller: Caller) {
    if (caller.kind !== "module" || !("moduleId" in caller)) throw fail("forbidden", "Only a module may use events");
    const module = owner(caller.moduleId, caller.module);
    if (module?.status !== "active" || module.activeHash !== caller.hash) throw fail("forbidden", "Caller is no longer the active module version");
    return caller;
  }
  async function subscribe(args: Record<string, unknown>, caller: Extract<Caller, { moduleId: string }>) {
    const { module, moduleId } = caller;
    const event = String(args.event ?? ""), tool = String(args.tool ?? "");
    if (!await declared(event)) throw fail("not_found", `No module declares the event ${event}`);
    const target = `${module}.${tool}`, callback = reference(moduleId, module, tool);
    if (!compatible(callback)) throw fail("forbidden", `${target} must be your own reachable tool accepting event, from and payload strings`);
    const publisher = directory.modules.find(candidate => candidate.status === "active" && event.startsWith(`${candidate.name}.`));
    if (!publisher) throw fail("not_found", "Event publisher is unavailable");
    const previous = store.rows().find(row => row.event === event && row.moduleId === moduleId && row.tool === tool);
    const row: Subscription = { event, module, moduleId, publisherId: publisher.id, tool, contractHash: callback!.contractHash!, revision: previous && !previous.invalid && previous.contractHash === callback!.contractHash && previous.publisherId === publisher.id ? previous.revision : randomUUID() };
    store.save([...store.rows().filter(other => !same(other, row)), row]);
    return { subscribed: true };
  }
  async function enqueue(row: Subscription, caller: Extract<Caller, { moduleId: string }>, message: { event: string; full: string; payload: string; requestKey: unknown }) {
    const { moduleId, module } = caller, { event, full, payload, requestKey } = message;
    const key = createHash("sha256").update(JSON.stringify([moduleId, event, String(requestKey ?? ""), row.moduleId, row.tool])).digest("hex"), intent = `key:${key}`;
    // Persist the revision before enqueue: a lost acknowledgement can only resume this registration.
    const saved = pending[intent];
    if (!saved) { pending[intent] = { ...row }; savePending(); }
    const expected = saved ?? row;
    const reply = await ports.call(`${expected.module}.${expected.tool}`, { event: full, from: module, payload }, { mode: "async", key, reply: true, expectedTarget: { moduleId: expected.moduleId, contractHash: expected.contractHash } });
    if ((!reply.duplicate || saved) && !pending[reply.callId]) pending[reply.callId] = { ...expected };
    delete pending[intent]; savePending();
  }
  async function emit(args: Record<string, unknown>, caller: Extract<Caller, { moduleId: string }>) {
    const { module, moduleId } = caller;
    const event = String(args.event ?? ""), full = `${module}.${event}`, declaration = await declared(full);
    if (!declaration) throw fail("not_found", `${full} is not declared in contributes.events.emits`);
    const payload = String(args.payload ?? "");
    if (Buffer.byteLength(payload) > MAX_PAYLOAD) throw fail("invalid", "payload is larger than 64 KiB");
    let data: unknown;
    try { data = JSON.parse(payload); } catch { throw fail("invalid", "payload must be JSON"); }
    check(declaration.payload, data);
    const subscribers = store.rows().filter(row => {
      const callback = reference(row.moduleId, row.module, row.tool);
      return row.event === full && row.publisherId === moduleId && !row.invalid && compatible(callback) && callback!.contractHash === row.contractHash;
    }).slice(0, MAX_SUBSCRIBERS);
    for (const row of subscribers) await enqueue(row, caller, { event, full, payload, requestKey: args.key });
    return { delivered: subscribers.length };
  }
  const handlers: Record<string, (args: Record<string, unknown>, caller: Extract<Caller, { moduleId: string }>) => unknown> = {
    subscriptions: (_args, caller) => ({ subscriptions: store.rows().filter(row => row.moduleId === caller.moduleId).map(({ event, module, tool }) => ({ event, module, tool })) }),
    unsubscribe: (args, caller) => {
      store.save(store.rows().filter(row => !(row.event === String(args.event ?? "") && row.moduleId === caller.moduleId && row.tool === String(args.tool ?? ""))));
      return { unsubscribed: true };
    },
    subscribe,
    emit,
  };
  return {
    async handle(id: string, args: Record<string, unknown>, caller: Caller) {
      if (caller.kind !== "module" || !("moduleId" in caller)) throw fail("forbidden", "Only a module may use events");
      await refresh();
      const module = moduleOf(caller);
      if (!Object.hasOwn(handlers, id)) throw fail("not_found", `events.${id} not found`);
      return handlers[id]!(args, module);
    },
    /** Receipts are fenced to the registration revision that actually enqueued them. */
    result(event: CallResult) {
      const row = pending[event.callId];
      if (!row) return;
      delete pending[event.callId]; savePending();
      if (event.status === "failed" && /^(forbidden|not_found|conflict)\b/.test(event.error ?? ""))
        store.save(store.rows().map(current => same(current, row) && current.revision === row.revision ? { ...current, invalid: true } : current));
    },
  };
}
