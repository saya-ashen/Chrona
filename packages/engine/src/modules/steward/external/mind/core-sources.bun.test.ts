import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreMindStore, evidenceId, objectRetractionId } from "./core-store";
import { CoreMindService } from "./core-service";
import { Database } from "bun:sqlite";
import { Observations } from "../chat/observations";
import { CoreSources, type ResolveSource, type SourceCall, type SourceIngestor } from "./core-sources";
import type { CoreAccess, IngestBatch } from "./core-types";

const now = "2026-11-13T12:00:00.000Z";
const identity = { moduleId: "actual-chat-module-id", hash: "approved-chat-hash", identityContinuityVerified: true };
const access: CoreAccess = { subject: "test:runtime", role: "runtime", scopes: [{}] };
const source = (epoch = "epoch-1") => ({ ...identity, epoch });
const ref = (id: string) => ({ kind: "message", id: JSON.stringify(["conversation", id]), revision: 1 });
const event = (n: number, epoch = "epoch-1", id = String(n), scopeRevision = 1) => ({
  id: `${epoch}:${n}`, cursor: String(n), object: ref(id), kind: "message" as const, actor: "user" as const,
  origin: { rootId: "conversation" }, occurredAt: now, receivedAt: now, scopeRevision,
  content: { text: `submitted user message ${id}`, truncated: false },
});
const feed = (events: ReturnType<typeof event>[], nextCursor: string, hasMore = false, epoch = "epoch-1", scopeRevision = 1) => ({
  source: source(epoch), events, nextCursor, hasMore, scopeRevision, capturedAt: now, coverage: { complete: true, oldestAvailableCursor: "0" },
});
const view = (objects: ReturnType<typeof ref>[], options: { epoch?: string; scopeRevision?: number; highWater?: string; token?: string; next?: string; more?: boolean } = {}) => ({
  source: source(options.epoch), objects, epoch: options.epoch ?? "epoch-1", scopeRevision: options.scopeRevision ?? 1,
  snapshotToken: options.token ?? "pinned-view", highWaterCursor: options.highWater ?? "10",
  nextCursor: options.next ?? String(objects.length), hasMore: options.more ?? false, coverage: { complete: true },
});
const snapshot = (item: ReturnType<typeof event>, options: { scopeRevision?: number; next?: string; more?: boolean; text?: string } = {}) => ({
  source: source(item.id.split(":")[0]), objectRef: item.object, currentRevision: item.object.revision,
  retracted: false, items: [{ ...item, content: { text: options.text ?? item.content.text, truncated: false } }],
  nextCursor: options.next ?? "0", hasMore: options.more ?? false, coverage: { complete: true }, scopeRevision: options.scopeRevision ?? item.scopeRevision,
});

describe("CoreSources pure Chat incremental synchronization", () => {
  let directory: string; let store: CoreMindStore; let service: CoreMindService;
  let errors: ReturnType<typeof spyOn>;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "mind-core-sources-")); store = new CoreMindStore(directory);
    service = new CoreMindService(store, { now: () => now }); errors = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }); errors.mockRestore(); });
  const batch = (events: ReturnType<typeof event>[], nextCursor: string, epoch = "epoch-1"): IngestBatch => ({
    sourceIdentity: identity.moduleId, epoch, expectedCheckpointRevision: 0, events: events.map(e => ({ ...e, eventId: e.id, scope: { sessionId: e.origin.rootId } })),
    nextCursor, scopeRevision: 1, capturedAt: now, coverage: { complete: true },
  });
  const scope = (startCursor = "0", revision = 1, epoch = "epoch-1", enabled = true) => ({ startCursor, revision, epoch, enabled });
  function transport(handler: (tool: string, args: Record<string, unknown>) => unknown | Promise<unknown>) {
    const calls: { tool: string; args: Record<string, unknown> }[] = [];
    const call: SourceCall = async (target, args) => {
      expect(target.moduleId).toBe(identity.moduleId);
      expect(["observations", "observation-scope", "observation-inventory", "snapshot"]).toContain(target.tool);
      calls.push({ tool: target.tool, args }); return handler(target.tool, args);
    };
    return { calls, call };
  }
  function sync(call: SourceCall, ingestor: SourceIngestor = service, resolve: () => typeof identity = () => identity) {
    return new CoreSources(store, ingestor, call, resolve);
  }

  test("starts at the declared new-event watermark, drains every feed page, preserves actor/origin and restarts idempotently", async () => {
    const records = Array.from({ length: 19 }, (_, i) => event(i + 11));
    const t = transport((tool, args) => {
      if (tool === "observation-scope") return scope("10");
      expect(tool).toBe("observations"); expect(args.sourceEpoch).toBe("epoch-1");
      const remaining = records.filter(e => BigInt(e.cursor) > BigInt(String(args.after)));
      const page = remaining.slice(0, 3);
      return { json: JSON.stringify(feed(page, page.at(-1)?.cursor ?? String(args.after), remaining.length > 3)) };
    });
    const first = await sync(t.call).sync();
    expect(first.status).toBe("synced"); expect(first.ingested).toBe(19); expect(first.rebuilt).toBe(false);
    expect(store.read().checkpoints[0]?.cursor).toBe("29"); expect(store.read().evidence).toHaveLength(19);
    expect(store.read().evidence[0]?.actor).toBe("user"); expect(store.read().evidence[0]?.scope).toEqual({});
    expect(store.read().evidence[0]?.origin.rootId).toBe("conversation");
    expect(t.calls.filter(c => c.tool === "observations")[0]?.args.after).toBe("10");
    const replay = await sync(t.call).sync(); expect(replay.status).toBe("synced"); expect(replay.ingested).toBe(0);
    expect(store.read().evidence).toHaveLength(19); expect(t.calls.some(c => c.tool === "snapshot")).toBe(false);
  });

  test("trusted project scope stays restrictive and cannot be broadened by Chat event data", async () => {
    const t = transport(tool => tool === "observation-scope" ? scope("0") : feed([{ ...event(11), scope: {} } as any], "11"));
    const restricted = sync(t.call, service, () => ({ ...identity, scope: { projectId: "project-a" } }));
    expect((await restricted.sync()).status).toBe("synced");
    const evidence = store.read().evidence[0]!;
    expect(evidence.scope).toEqual({ projectId: "project-a" });
    const owner = { subject: "owner", role: "owner" as const, scopes: [{}] };
    const remembered = service.remember({ actionKey: "remember-project", expectedVisibilityRevision: store.inspect(tx => tx.meta().visibilityRevision), expectedRevision: 0,
      kind: "preference", value: "Project preference", scope: { projectId: "project-a" }, explicitness: "explicit", supportingRefs: [evidence.id] }, owner);
    expect(service.context({ scope: {} }, owner).understandings.some(u => u.id === remembered.value!.id)).toBe(false);
    expect(service.context({ scope: { projectId: "project-a" } }, owner).understandings.some(u => u.id === remembered.value!.id)).toBe(true);
  });

  test("a real SQLite transaction rolls back the entire batch and leaves the cursor when its second event is invalid", async () => {
    const bad = event(12); bad.object.id = "x".repeat(513);
    const t = transport(tool => tool === "observation-scope" ? scope("10") : feed([event(11), bad], "12"));
    const result = await sync(t.call).sync();
    expect(result.status).toBe("degraded"); expect(store.read().evidence).toHaveLength(0);
    expect(store.read().checkpoints[0]?.cursor).toBe("10"); expect(result.coverage.complete).toBe(false);
  });

  test("rebuilds a gap across complete inventory and UTF-8 snapshot pages, retracts missing objects, then drains the watermark", async () => {
    service.ingest(batch([event(1, "epoch-1", "deleted")], "1"), access);
    const item = event(5, "epoch-2", "retained"); let feedReads = 0;
    const t = transport((tool, args) => {
      if (tool === "observation-scope") return scope("0", 1, "epoch-2");
      if (tool === "observation-inventory") {
        if (!args.snapshotToken) return view([item.object], { epoch: "epoch-2", next: "1", more: true });
        expect(args.snapshotToken).toBe("pinned-view"); expect(args.cursor).toBe("1");
        return view([], { epoch: "epoch-2", next: "1" });
      }
      if (tool === "snapshot") {
        expect(args.snapshotToken).toBe("pinned-view"); expect(args.expectedRevision).toBe(1);
        return snapshot(item, args.cursor ? { text: "世界", next: "12" } : { text: "你好", next: "6", more: true });
      }
      feedReads++; expect(args.sourceEpoch).toBe("epoch-2"); expect(args.after).toBe("10");
      return feed([event(11, "epoch-2", "new-during-rebuild")], "11", false, "epoch-2");
    });
    const result = await sync(t.call).sync();
    expect(result.status).toBe("synced"); expect(result.rebuilt).toBe(true); expect(feedReads).toBe(1);
    const state = store.read(); expect(state.checkpoints[0]?.cursor).toBe("11"); expect(state.checkpoints[0]?.epoch).toBe("epoch-2");
    expect(state.evidence.find(e => e.eventId === item.id)?.content?.text).toBe("你好世界");
    expect(state.evidence.find(e => e.eventId === "epoch-1:1")?.retractedAt).toBeDefined();
    expect(state.retractions.some(r => r.id === objectRetractionId(identity.moduleId, "message", ref("deleted").id))).toBe(true);
  });

  test("rebuilds more than 50 objects without advancing the cursor during bounded staging", async () => {
    service.ingest(batch([], "1"), access);
    const items = Array.from({ length: 63 }, (_, i) => event(i + 2, "epoch-2"));
    const writes: IngestBatch[] = [];
    const ingestor: SourceIngestor = { ingest(value, actor) { writes.push(structuredClone(value)); return service.ingest(value, actor); } };
    const t = transport((tool, args) => {
      if (tool === "observation-scope") return scope("0", 1, "epoch-2");
      if (tool === "observation-inventory") {
        const offset = Number(args.cursor ?? 0); const part = items.slice(offset, offset + 7);
        return view(part.map(e => e.object), { epoch: "epoch-2", highWater: "70", next: String(offset + part.length), more: offset + part.length < items.length });
      }
      if (tool === "snapshot") return snapshot(items.find(e => e.object.id === (args.objectRef as { id: string }).id)!);
      expect(args.after).toBe("70"); return feed([], "70", false, "epoch-2");
    });
    const result = await sync(t.call, ingestor).sync();
    expect(result.status).toBe("synced"); expect(store.read().evidence).toHaveLength(63);
    expect(writes.every(w => w.events.length <= 50)).toBe(true);
    const staged = writes.filter(w => w.events.length && !w.coverage.complete);
    expect(staged).toHaveLength(1); expect(staged[0]?.nextCursor).toBe("1");
    expect(store.read().checkpoints[0]?.cursor).toBe("70");
  });

  test("a competing writer between rebuild chunks cannot have its cursor or revision adopted", async () => {
    service.ingest(batch([], "1"), access);
    const items = Array.from({ length: 63 }, (_, i) => event(i + 2, "epoch-2")); let competed = false;
    const ingestor: SourceIngestor = { async ingest(value, actor) {
      const own = service.ingest(value, actor);
      if (value.events.length === 50 && !value.coverage.complete) {
        await Promise.resolve(); competed = true;
        service.ingest({ ...value, events: [], expectedCheckpointRevision: own.revision, nextCursor: "100", coverage: { complete: true } }, actor);
      }
      return own;
    } };
    const t = transport(tool => {
      if (tool === "observation-scope") return scope("0", 1, "epoch-2");
      if (tool === "observation-inventory") return view(items.map(e => e.object), { epoch: "epoch-2", highWater: "70" });
      throw Error("inventory must use bounded pages");
    });
    // Use a realistic paginated inventory while racing only the ingest boundary.
    const call: SourceCall = async (target, args) => {
      if (target.tool === "observation-inventory") {
        const offset = Number(args.cursor ?? 0); const part = items.slice(offset, offset + 40);
        return view(part.map(e => e.object), { epoch: "epoch-2", highWater: "70", next: String(offset + part.length), more: offset + part.length < items.length });
      }
      if (target.tool === "snapshot") return snapshot(items.find(e => e.object.id === (args.objectRef as { id: string }).id)!);
      return t.call(target, args);
    };
    const result = await sync(call, ingestor).sync(); expect(competed).toBe(true);
    expect(result.unknowns).toContain("CONFLICT"); expect(store.read().checkpoints[0]?.cursor).toBe("100");
    expect(store.read().evidence).toHaveLength(50);
  });

  test("scope changes during snapshots discard the entire mixed view and restart with a fresh token", async () => {
    service.ingest(batch([], "1"), access); let attempt = 0; let currentRevision = 2;
    const item = event(3, "epoch-1", "kept", 2);
    const t = transport((tool, args) => {
      if (tool === "observation-scope") return scope("0", currentRevision);
      if (tool === "observation-inventory") { attempt++; return view([item.object], { scopeRevision: currentRevision, token: `view-${attempt}` }); }
      if (tool === "snapshot") {
        if (attempt === 1) { currentRevision = 3; return { error: { code: "scope_changed", message: "PRIVATE RAW ERROR" } }; }
        expect(args.snapshotToken).toBe("view-2"); return snapshot(item, { scopeRevision: 3, text: "current permitted view" });
      }
      return feed([], "10", false, "epoch-1", 3);
    });
    const result = await sync(t.call).sync(); expect(result.status).toBe("synced"); expect(attempt).toBe(2);
    expect(store.read().evidence).toHaveLength(1); expect(store.read().evidence[0]?.content?.text).toBe("current permitted view");
  });

  test("inconsistent inventory metadata never commits a successful watermark", async () => {
    service.ingest(batch([event(1)], "1"), access);
    const t = transport((tool, args) => {
      if (tool === "observation-scope") return scope("0", 2);
      if (tool === "observation-inventory") return args.cursor ? view([ref("b")], { scopeRevision: 2, token: "different-view", next: "2" }) : view([ref("a")], { scopeRevision: 2, next: "1", more: true });
      throw Error("must never read snapshots of inconsistent inventory");
    });
    const result = await sync(t.call).sync();
    expect(result.status).toBe("degraded"); expect(result.unknowns).toContain("inconsistent_inventory");
    expect(store.read().checkpoints[0]?.cursor).toBe("1"); expect(store.read().checkpoints[0]?.coverage.complete).toBe(false);
    expect(store.read().evidence).toHaveLength(1);
  });

  test("expired snapshots retry a bounded number of times and leave incomplete coverage visible", async () => {
    service.ingest(batch([], "1"), access); let attempts = 0;
    const t = transport(tool => {
      if (tool === "observation-scope") return scope("0", 2);
      if (tool === "observation-inventory") { attempts++; return view([ref("a")], { scopeRevision: 2, token: `view-${attempts}` }); }
      return { error: { code: "snapshot_expired", message: "PRIVATE RAW ERROR" } };
    });
    const result = await sync(t.call).sync(); expect(result.status).toBe("degraded"); expect(attempts).toBe(3);
    expect(result.unknowns).toContain("snapshot_expired"); expect(store.read().checkpoints[0]?.cursor).toBe("1");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("PRIVATE RAW ERROR");
  });

  test("scope withdrawal tombstones source objects, and re-enable/epoch replay cannot resurrect them", async () => {
    const original = event(1); service.ingest(batch([original], "1"), access);
    const disabled = transport(() => scope("0", 2, "epoch-1", false));
    expect((await sync(disabled.call).sync()).status).toBe("disabled");
    expect(disabled.calls).toHaveLength(1); expect(store.read().evidence[0]?.content).toBeUndefined();
    expect(store.read().retractions).toHaveLength(1);
    const replay = event(2, "epoch-2", "1", 2);
    const enabled = transport(tool => {
      if (tool === "observation-scope") return scope("0", 2, "epoch-2");
      if (tool === "observation-inventory") return view([replay.object], { epoch: "epoch-2", scopeRevision: 2 });
      if (tool === "snapshot") return snapshot(replay);
      return feed([], "10", false, "epoch-2", 2);
    });
    expect((await sync(enabled.call).sync()).status).toBe("synced");
    expect(store.read().evidence.some(e => e.content?.text)).toBe(false);
    expect(store.read().evidence.find(e => e.id === evidenceId(identity.moduleId, "epoch-2", replay.id))).toBeUndefined();
  });

  test("forgotten objects stay forgotten when a consistent gap rebuild returns their old content", async () => {
    const original = event(1); service.ingest(batch([original], "1"), access);
    service.forget({ actionKey: "forget", expectedVisibilityRevision: 0, target: { kind: "object", sourceIdentity: identity.moduleId, objectKind: "message", objectId: original.object.id } }, { subject: "owner", role: "owner", scopes: [{}] });
    const replay = event(2, "epoch-2", "1");
    const t = transport(tool => tool === "observation-scope" ? scope("0", 1, "epoch-2") : tool === "observation-inventory" ? view([replay.object], { epoch: "epoch-2" }) : tool === "snapshot" ? snapshot(replay) : feed([], "10", false, "epoch-2"));
    expect((await sync(t.call).sync()).status).toBe("synced"); expect(store.read().evidence.some(e => e.content?.text)).toBe(false);
  });

  test("unknown/blocked restore ledger fails closed before resolving or reading the source", async () => {
    let resolves = 0; let reads = 0;
    const sources = new CoreSources(store, service, async () => { reads++; throw Error("unexpected source read"); }, () => { resolves++; return identity; });
    for (const restoreBlocked of [true, undefined]) {
      store.update(tx => tx.setSettings({ ...tx.settings(), restoreBlocked: restoreBlocked as boolean }));
      expect((await sources.sync()).status).toBe("blocked");
    }
    expect(resolves).toBe(0); expect(reads).toBe(0); expect(store.read().checkpoints).toHaveLength(0);
  });

  test("an epoch change without trusted identity continuity leaves old coverage blocked", async () => {
    service.ingest(batch([event(1)], "1"), access);
    const t = transport(tool => tool === "observation-scope" ? scope("0", 1, "epoch-2") : view([], { epoch: "epoch-2" }));
    const sources = new CoreSources(store, service, t.call, () => ({ moduleId: identity.moduleId, hash: identity.hash }));
    const result = await sources.sync(); expect(result.status).toBe("blocked");
    expect(result.unknowns).toContain("RESTORE_BLOCKED"); expect(store.read().checkpoints[0]?.epoch).toBe("epoch-1");
    expect(store.read().checkpoints[0]?.coverage.complete).toBe(false);
    expect(t.calls.some(c => c.tool === "snapshot" || c.tool === "observations")).toBe(false);
  });

  test("source errors and wrong module/hash are visible without logging raw error text", async () => {
    const t = transport(tool => {
      if (tool === "observation-scope") return scope("10");
      throw Error("secret original message: never log me");
    });
    const result = await sync(t.call).sync(); expect(result.status).toBe("unavailable");
    expect(result.unknowns).toContain("source_call_failed"); expect(store.read().checkpoints[0]?.coverage.complete).toBe(false);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret original");
    const mismatch = transport(tool => tool === "observation-scope" ? scope("10") : { ...feed([], "10"), source: { ...source(), hash: "other-hash" } });
    // First incomplete checkpoint triggers inventory; source identity is checked there too.
    store.update(tx => { const cp = tx.list("checkpoint")[0]!; tx.put("checkpoint", { ...cp, coverage: { complete: true } }); });
    const wrong = await sync(mismatch.call).sync(); expect(wrong.unknowns).toContain("source_identity_mismatch");
  });

  test("non-advancing feed pages fail after one page, never silently succeed or loop", async () => {
    const t = transport(tool => tool === "observation-scope" ? scope("10") : feed([], "10", true));
    const result = await sync(t.call).sync(); expect(result.unknowns).toContain("non_advancing_feed");
    expect(t.calls.filter(c => c.tool === "observations")).toHaveLength(1); expect(store.read().checkpoints[0]?.cursor).toBe("10");
  });

  test("actual Chat evidence can support shared memory, then session forget fences old replay", async () => {
    const db = new Database(":memory:");
    try {
      db.run("CREATE TABLE conversations(id TEXT PRIMARY KEY)");
      db.run("INSERT INTO conversations VALUES ('conversation'), ('new-conversation')");
      const chat = new Observations(db, () => identity);
      chat.scopeTool({ expectedRevision: 0, enabled: true });
      chat.saved({ id: "conversation", messages: [], operations: [] }, {
        id: "conversation", messages: [{ id: "preference", role: "user", at: now, text: "I prefer concise answers" }], operations: [],
      });
      const makeTransport = transport((tool, args) => tool === "observation-scope" ? chat.scopeTool(args)
        : tool === "observation-inventory" ? chat.inventory(args) : tool === "snapshot" ? chat.snapshot(args) : chat.observations(args));
      const sources = sync(makeTransport.call);
      expect((await sources.sync()).status).toBe("synced");
      const evidence = store.read().evidence.find(e => e.object.kind === "message")!;
      expect(evidence.scope).toEqual({});
      const owner = { subject: "owner", role: "owner" as const, scopes: [{}] };
      const remembered = service.remember({ actionKey: "remember-shared", expectedVisibilityRevision: store.inspect(tx => tx.meta().visibilityRevision), expectedRevision: 0, kind: "preference",
        value: "The user prefers concise answers", scope: {}, explicitness: "explicit", supportingRefs: [evidence.id] },
        owner);
      const recalled = service.context({ scope: { sessionId: "new-conversation" } }, owner);
      expect(recalled.understandings.some(u => u.id === remembered.value!.id)).toBe(true);

      service.forget({ actionKey: "forget-conversation", expectedVisibilityRevision: recalled.visibilityRevision,
        target: { kind: "session", sessionId: "conversation" } },
        { subject: "owner", role: "owner", scopes: [{}] });
      expect(service.context({ scope: {} }, owner).understandings.some(u => u.id === remembered.value!.id)).toBe(false);
      store.update(tx => { const cp = tx.list("checkpoint")[0]!; tx.put("checkpoint", { ...cp, revision: cp.revision + 1, coverage: { complete: false, gap: "retention_gap" } }); });
      const replay = transport((tool, args) => tool === "observation-scope" ? chat.scopeTool(args)
        : tool === "observation-inventory" ? chat.inventory(args) : tool === "snapshot" ? chat.snapshot(args) : chat.observations(args));
      expect((await sync(replay.call).sync()).status).toBe("synced");
      expect(store.read().evidence.some(e => e.content?.text?.includes("concise"))).toBe(false);
      expect(service.context({ scope: { sessionId: "new-conversation" } }, owner).understandings).toHaveLength(0);
    } finally { db.close(); }
  });

  test.each(["missing", "invalid", "throws", "rejects"] as const)("persisted real Chat coverage fails closed when resolution %s, then rebuilds authorized context and work", async failure => {
    const db = new Database(":memory:");
    try {
      db.run("CREATE TABLE conversations(id TEXT PRIMARY KEY)"); db.run("INSERT INTO conversations VALUES ('conversation')");
      const chat = new Observations(db, () => identity);
      const historical = { id: "conversation", messages: [{ id: "history", role: "user", at: now, text: "Before learning was enabled" }], operations: [] };
      chat.saved({ ...historical, messages: [] }, historical);
      chat.scopeTool({ expectedRevision: 0, enabled: true });
      chat.saved(historical, { ...historical, messages: [...historical.messages,
        { id: "live", role: "user", at: now, text: "Please organize the project notes" },
        { id: "forgotten", role: "user", at: now, text: "Forget this old preference" },
      ] });
      const t = transport((tool, args) => tool === "observation-scope" ? chat.scopeTool(args)
        : tool === "observation-inventory" ? chat.inventory(args) : tool === "snapshot" ? chat.snapshot(args) : chat.observations(args));
      const approved = { ...identity, scope: { projectId: "project-a" } };
      expect((await new CoreSources(store, service, t.call, () => approved).sync()).status).toBe("synced");
      expect(t.calls.some(c => c.tool === "observation-inventory")).toBe(false);
      const evidence = store.read().evidence.find(e => e.object.id === JSON.stringify(["conversation", "live"]))!;
      const forgotten = store.read().evidence.find(e => e.object.id === JSON.stringify(["conversation", "forgotten"]))!;
      expect(evidence.scope).toEqual(approved.scope);
      expect(store.read().evidence.some(e => e.content?.text?.includes("Before learning"))).toBe(false);
      const owner: CoreAccess = { subject: "owner", role: "owner", scopes: [{}] };
      const visibility = () => store.read().visibilityRevision;
      const remembered = service.remember({ actionKey: "remember-live", expectedVisibilityRevision: visibility(), expectedRevision: 0,
        kind: "goal", value: "Organize project notes", scope: approved.scope, explicitness: "explicit", supportingRefs: [evidence.id] }, owner).value!;
      const pursuit = service.pursue({ actionKey: "pursue-live", expectedVisibilityRevision: visibility(), expectedRevision: 0,
        semanticKey: "organize-notes", goal: "Organize project notes", completionCriteria: ["Notes are organized"], scope: approved.scope,
        reason: "explicit-goal", evidenceRefs: [evidence.id], understandingRefs: [remembered.id] }, owner).value!;
      service.forget({ actionKey: "forget-old", expectedVisibilityRevision: visibility(), target: { kind: "object",
        sourceIdentity: identity.moduleId, objectKind: forgotten.object.kind, objectId: forgotten.object.id } }, owner);
      const tombstones = store.read().retractions;
      const worker: CoreAccess = { ...access, execution: { actor: "notes-worker", runRef: "notes-run" } };
      const claimed = service.claim({ actionKey: "claim-notes", expectedVisibilityRevision: visibility(), expectedRevision: pursuit.revision,
        pursuitId: pursuit.id }, worker).value!;
      const guard = (actionKey: string) => service.guardAction({ actionKey, expectedVisibilityRevision: visibility(),
        expectedRevision: claimed.revision, pursuitId: pursuit.id, target: "notes:organize", arguments: {} }, worker);
      expect(() => guard("before-outage")).not.toThrow();
      expect(service.context({ scope: approved.scope }, owner).understandings.map(u => u.id)).toContain(remembered.id);
      expect(service.context({ scope: {} }, owner).understandings).toEqual([]);

      // Reopen SQLite and construct a fresh synchronizer: ownership must survive process memory.
      store.close(); store = new CoreMindStore(directory); service = new CoreMindService(store, { now: () => now });
      const before = store.read().checkpoints[0]!;
      const resolve: ResolveSource = () => {
        if (failure === "throws") throw Error("private resolver failure");
        if (failure === "rejects") return Promise.reject(Error("private resolver failure"));
        return failure === "invalid" ? { moduleId: identity.moduleId, hash: "" } : undefined;
      };
      const reads = t.calls.length;
      const unavailable = await new CoreSources(store, service, t.call, resolve).sync();
      expect(unavailable.status).toBe("unavailable"); expect(unavailable.unknowns).toEqual(["source_unavailable"]);
      expect(unavailable.coverage).toEqual({ complete: false, gap: "source_unavailable" }); expect(unavailable.source).toBeUndefined();
      expect(t.calls).toHaveLength(reads);
      const withdrawn = store.read().checkpoints[0]!;
      expect(withdrawn.coverage).toEqual({ ...before.coverage, complete: false, gap: "source_unavailable" });
      expect(withdrawn.cursor).toBe(before.cursor); expect(withdrawn.epoch).toBe(before.epoch);
      expect(withdrawn.scopeRevision).toBe(before.scopeRevision);
      const context = service.context({ scope: approved.scope }, owner);
      expect(context.understandings).toEqual([]); expect(context.pursuits).toEqual([]); expect(context.evidence).toEqual([]);
      expect(context.unknowns).toContain(`${identity.moduleId}: source_unavailable`);
      expect(() => guard("during-outage")).toThrow("coverage");
      expect(store.read().actions.some(a => a.id === "during-outage")).toBe(false);
      expect(JSON.stringify(errors.mock.calls)).not.toContain("private resolver failure");

      const recovered = await new CoreSources(store, service, t.call, () => approved).sync();
      expect(recovered.status).toBe("synced"); expect(recovered.rebuilt).toBe(true); expect(recovered.coverage.complete).toBe(true);
      expect(t.calls.slice(reads).some(c => c.tool === "observation-inventory")).toBe(true);
      expect(t.calls.slice(reads).filter(c => c.tool === "observation-scope").length).toBeGreaterThanOrEqual(3);
      const restored = service.context({ scope: approved.scope }, owner);
      expect(restored.understandings.map(u => u.id)).toContain(remembered.id); expect(restored.pursuits.map(p => p.id)).toContain(pursuit.id);
      expect(() => guard("after-recovery")).not.toThrow();
      expect(service.context({ scope: {} }, owner).understandings).toEqual([]);
      expect(service.context({ scope: { projectId: "project-b" } }, owner).pursuits).toEqual([]);
      expect(store.read().retractions).toEqual(tombstones);
      expect(store.read().evidence.find(e => e.id === forgotten.id)?.content).toBeUndefined();
      expect(store.read().evidence.some(e => e.content?.text?.includes("Before learning"))).toBe(false);
    } finally { db.close(); }
  });

  test("missing resolution invalidates every persisted Chat identity, including retracted evidence, without guessing foreign owners", async () => {
    for (const moduleId of [identity.moduleId, "previous-chat-module"]) {
      const call: SourceCall = async target => {
        expect(target.moduleId).toBe(moduleId);
        return target.tool === "observation-scope" ? scope() : { ...feed([event(1)], "1"), source: { ...source(), moduleId } };
      };
      expect((await new CoreSources(store, service, call, () => ({ ...identity, moduleId })).sync()).status).toBe("synced");
    }
    // The active payload may be forgotten while its authenticated source marker remains.
    const owner: CoreAccess = { subject: "owner", role: "owner", scopes: [{}] };
    const old = store.read().evidence.find(e => e.sourceIdentity === "previous-chat-module")!;
    service.forget({ actionKey: "forget-old-chat", expectedVisibilityRevision: store.read().visibilityRevision,
      target: { kind: "evidence", id: old.id } }, owner);
    for (const sourceIdentity of ["chat", "unrelated-calendar"]) service.ingest({ ...batch([event(1)], "1"), sourceIdentity }, access);
    const foreign = store.read().checkpoints.filter(cp => ["chat", "unrelated-calendar"].includes(cp.sourceIdentity));
    let reads = 0;
    const missing = new CoreSources(store, service, async () => { reads++; throw Error("unexpected source read"); }, () => undefined);
    expect((await missing.sync()).unknowns).toEqual(["source_unavailable"]);
    expect(reads).toBe(0);
    for (const moduleId of [identity.moduleId, "previous-chat-module"]) {
      expect(store.read().checkpoints.find(cp => cp.sourceIdentity === moduleId)?.coverage).toMatchObject({ complete: false, gap: "source_unavailable" });
    }
    expect(store.read().checkpoints.filter(cp => ["chat", "unrelated-calendar"].includes(cp.sourceIdentity))).toEqual(foreign);
    const withdrawn = store.read().checkpoints;
    await missing.sync(); expect(store.read().checkpoints).toEqual(withdrawn);
  });

  test("real Chat feed and opaque snapshot cursors rebuild long non-ASCII content without calling Chat read", async () => {
    const db = new Database(":memory:");
    try {
      db.run("CREATE TABLE conversations(id TEXT PRIMARY KEY)"); db.run("INSERT INTO conversations VALUES ('conversation')");
      const chat = new Observations(db, () => identity);
      const initial = chat.scopeTool(); chat.scopeTool({ expectedRevision: initial.revision, enabled: true });
      const longText = "你好🌍".repeat(5000);
      const conversation = { id: "conversation", messages: [{ id: "long-message", role: "user", at: now, text: longText }], operations: [] };
      chat.saved({ id: "conversation", messages: [], operations: [] }, conversation);
      const currentScope = chat.scopeTool();
      service.ingest({ ...batch([], "0", currentScope.epoch), scopeRevision: currentScope.revision, coverage: { complete: false, gap: "retention_gap" } }, access);
      const t = transport((tool, args) => {
        if (tool === "observation-scope") return chat.scopeTool(args);
        if (tool === "observation-inventory") return chat.inventory(args);
        if (tool === "snapshot") return chat.snapshot(args);
        return chat.observations(args);
      });
      const result = await sync(t.call).sync(); expect(result.status).toBe("synced"); expect(result.rebuilt).toBe(true);
      expect(t.calls.filter(c => c.tool === "snapshot").length).toBeGreaterThan(1);
      const content = store.read().evidence.find(e=>e.object.kind==='message')?.content;
      expect(content?.truncated).toBe(true); expect(Buffer.byteLength(content?.text ?? "")).toBeLessThanOrEqual(16384);
      expect(content?.text?.includes("�")).toBe(false); expect(longText.startsWith(content?.text ?? "")).toBe(true);
      expect(store.read().checkpoints[0]?.epoch).toBe(currentScope.epoch);
    } finally { db.close(); }
  });

  test.each(["\\", "\u0000"])("real Chat escaped text (%j) has identical bounded digests from feed and later gap rebuild", async character => {
    const db = new Database(":memory:");
    try {
      db.run("CREATE TABLE conversations(id TEXT PRIMARY KEY)"); db.run("INSERT INTO conversations VALUES ('conversation')");
      const chat = new Observations(db, () => identity); chat.scopeTool({ expectedRevision: 0, enabled: true });
      const text = character.repeat(20_000);
      chat.saved({ id: "conversation", messages: [], operations: [] }, {
        id: "conversation", messages: [{ id: "escaped", role: "user", at: now, text }], operations: [],
      });
      const t = transport((tool, args) => tool === "observation-scope" ? chat.scopeTool(args)
        : tool === "observation-inventory" ? chat.inventory(args) : tool === "snapshot" ? chat.snapshot(args) : chat.observations(args));
      const sources = sync(t.call); expect((await sources.sync()).status).toBe("synced");
      const original = store.read().evidence.find(e=>e.object.kind==='message')!;
      expect(original.content?.truncated).toBe(true); expect(text.startsWith(original.content?.text ?? "")).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(original.content))).toBeLessThan(60000);
      store.update(tx => { const cp = tx.list("checkpoint")[0]!; tx.put("checkpoint", { ...cp, revision: cp.revision + 1, coverage: { complete: false, gap: "retention_gap" } }); });
      const rebuilt = await sources.sync(); expect(rebuilt.status).toBe("synced"); expect(rebuilt.rebuilt).toBe(true);
      expect(store.read().evidence).toHaveLength(2); expect(store.read().evidence.find(e=>e.id===original.id)?.sourceDigest).toBe(original.sourceDigest);
      expect(store.read().evidence.find(e=>e.id===original.id)?.content).toEqual(original.content);
      expect(store.read().evidence.find(e=>e.object.kind==='execution')?.content?.text).toContain('terminalConfirmed');
      expect(t.calls.some(c => c.tool === "snapshot" && !c.args.snapshotToken)).toBe(true);
      expect(t.calls.some(c => c.tool === "snapshot" && !!c.args.snapshotToken)).toBe(true);
    } finally { db.close(); }
  });

  test("the page budget reports incomplete coverage and leaves successfully committed pages resumable", async () => {
    const t = transport((tool, args) => {
      if (tool === "observation-scope") return scope();
      expect(tool).toBe("observations");
      const next = BigInt(String(args.after)) + 1n;
      return feed([], String(next), next < 600n);
    });
    const sources = sync(t.call); const result = await sources.sync();
    expect(result.status).toBe("degraded"); expect(result.unknowns).toContain("page_budget_exceeded");
    expect(result.pages).toBeLessThanOrEqual(513); expect(store.read().checkpoints[0]?.coverage.complete).toBe(false);
    const firstCursor = BigInt(store.read().checkpoints[0]!.cursor); expect(firstCursor).toBeGreaterThan(0n);
    const next = await sources.sync(); expect(BigInt(store.read().checkpoints[0]!.cursor)).toBeGreaterThan(firstCursor);
    expect(next.status).toBe("degraded");
    expect((await sources.sync()).status).toBe("synced"); expect(store.read().checkpoints[0]?.cursor).toBe("600");
    expect(t.calls.some(c => c.tool === "observation-inventory")).toBe(false);
  }, 30000);

  test("learning pause and missing approved source are visible without source reads", async () => {
    let reads = 0; const call: SourceCall = async () => { reads++; throw Error("unexpected"); };
    store.update(tx => tx.setSettings({ ...tx.settings(), learningEnabled: false }));
    expect((await sync(call).sync()).status).toBe("paused");
    store.update(tx => tx.setSettings({ ...tx.settings(), learningEnabled: true }));
    const missing = new CoreSources(store, service, call, () => undefined);
    expect((await missing.sync()).status).toBe("unavailable"); expect(reads).toBe(0);
  });

  test("per-instance concurrent syncs share work, while checkpoint CAS rejects another writer", async () => {
    service.ingest(batch([], "1"), access); let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const arrival = new Promise<void>(resolve => { entered = resolve; });
    const t = transport(async tool => {
      if (tool === "observation-scope") return scope();
      entered(); await gate; return feed([event(2)], "2");
    });
    const sources = sync(t.call); const first = sources.sync(); const second = sources.sync(); expect(first).toBe(second);
    await arrival;
    store.update(tx => { const cp = tx.list("checkpoint")[0]!; tx.put("checkpoint", { ...cp, revision: cp.revision + 1, cursor: "3" }); });
    release(); const result = await first;
    expect(result.unknowns).toContain("CONFLICT"); expect(store.read().checkpoints[0]?.cursor).toBe("3"); expect(store.read().evidence).toHaveLength(0);
  });
});
