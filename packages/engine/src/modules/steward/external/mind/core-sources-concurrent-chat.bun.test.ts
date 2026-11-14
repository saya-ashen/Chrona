import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store as ChatStore } from "../chat/state";
import { objectId } from "../chat/observations";
import { CoreMindStore, sessionRetractionId } from "./core-store";
import { CoreMindService } from "./core-service";
import { CoreSources, type SourceCall } from "./core-sources";
import type { CoreAccess, Evidence } from "./core-types";

const initialTime = "2026-09-01T12:00:00.000Z";
const retainedTime = "2026-10-02T12:00:00.000Z";
const identity = { moduleId: "joined-chat-source", hash: "joined-chat-approved-hash" };
const owner: CoreAccess = { subject: "owner", role: "owner", scopes: [{}] };

type Call = {
  tool: string;
  args: Record<string, unknown>;
  // These are the actual public Chat responses, never replacement source data.
  result?: ReturnType<ChatStore["observations"]["inventory"]>;
  error?: string;
};
function gate() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, async pause() { enter(); await released; } };
}
async function reached(barrier: ReturnType<typeof gate>, work: Promise<unknown>) {
  await Promise.race([barrier.entered, work.then(result => {
    throw new Error(`Synchronization ended before the expected race boundary: ${JSON.stringify(result)}`);
  })]);
}

describe("acceptance32 scenario31: joined Chat inventory rebuild with concurrent writes", () => {
  let directory: string, chat: ChatStore, mind: CoreMindStore, service: CoreMindService;
  let calls: Call[], beforeCall: ((call: Call) => Promise<void>) | undefined;
  let main: string, doomed: string, forgotten: string, hidden: string, historical: string;
  let oldCursor: string;

  function openChat() {
    const store = new ChatStore(join(directory, "chat"), join(directory, "content"), async () => {
      throw new Error("This joined source regression must never call a model or external service");
    });
    store.moduleId = identity.moduleId; store.version = identity.hash;
    return store;
  }
  function reopen() {
    chat.db.close(); mind.close();
    chat = openChat(); mind = new CoreMindStore(join(directory, "mind"));
    service = new CoreMindService(mind, { now: () => new Date().toISOString() });
  }
  const call: SourceCall = async (target, args) => {
    expect(target.moduleId).toBe(identity.moduleId);
    const entry: Call = { tool: target.tool, args: structuredClone(args) };
    calls.push(entry);
    await beforeCall?.(entry);
    try {
      switch (target.tool) {
        case "observation-scope": entry.result = chat.observations.scopeTool(args); break;
        case "observation-inventory": entry.result = chat.observations.inventory(args); break;
        case "snapshot": entry.result = chat.observations.snapshot(args); break;
        case "observations": entry.result = chat.observations.observations(args); break;
        default: throw new Error(`Unexpected Chat read: ${target.tool}`);
      }
      return entry.result;
    } catch (error) {
      entry.error = String((error as { code?: string }).code ?? "unexpected");
      throw error;
    }
  };
  const sources = () => new CoreSources(mind, service, call, () => identity);
  function append(conversationId: string, id: string, text: string) {
    const c = chat.get(conversationId);
    c.messages.push({ id, role: "user", text, attachments: [], at: new Date().toISOString() });
    chat.save(c);
  }
  function correct(conversationId: string, id: string, text: string) {
    const c = chat.get(conversationId);
    c.messages.find((message: { id: string }) => message.id === id).text = text;
    chat.save(c);
  }
  function scope(patch: Record<string, unknown>) {
    return chat.observations.scopeTool({ expectedRevision: chat.observations.scopeTool().revision, ...patch });
  }
  function checkpoint() { return mind.read().checkpoints.find(cp => cp.sourceIdentity === identity.moduleId)!; }
  function liveMessages() {
    return mind.read().evidence.filter(e => e.object.kind === "message" && !e.retractedAt && !e.expiredAt);
  }
  function message(conversationId: string, localId: string) {
    return liveMessages().find(e => e.object.id === objectId(conversationId, localId));
  }
  function assertAuthorizedAndForgotten() {
    const state = mind.read();
    expect(state.retractions.some(r => r.id === sessionRetractionId(forgotten) && r.reason === "forgotten")).toBe(true);
    expect(state.evidence.filter(e => [forgotten, hidden, historical].includes(e.origin.rootId)).every(e => !e.content)).toBe(true);
    expect(JSON.stringify(state.evidence)).not.toContain("FORGOTTEN_PRIVATE_TEXT");
    expect(JSON.stringify(state.evidence)).not.toContain("EXCLUDED_PRIVATE_TEXT");
    expect(JSON.stringify(state.evidence)).not.toContain("PRE_ENABLE_PRIVATE_TEXT");
    expect(JSON.stringify(state.evidence)).not.toContain("UNSUBMITTED_DRAFT_TEXT");
    // No independently fabricated understandings or semantic admission claims.
    expect(state.understandings).toHaveLength(0);
    expect(state.pursuits).toHaveLength(0);
  }
  function assertMatchesSnapshot(token: string, epoch: string) {
    type SourceFields = Pick<Evidence, "object" | "cursor" | "kind" | "actor" | "origin" | "content" | "scopeRevision" | "occurredAt" | "receivedAt">;
    const project = (e: SourceFields, eventId: string) => ({
      eventId, object: e.object, cursor: e.cursor, kind: e.kind, actor: e.actor, origin: e.origin,
      occurredAt: e.occurredAt, receivedAt: e.receivedAt, scopeRevision: e.scopeRevision,
      content: e.content ? { text: e.content.text, truncated: e.content.truncated, artifactRefs: e.content.artifactRefs ?? [] } : undefined,
    });
    const snapshots = calls.filter(c => c.tool === "snapshot" && c.args.snapshotToken === token);
    const expected = snapshots.flatMap(c => c.result.items).filter(e => e.origin.rootId !== forgotten);
    expect(expected.length).toBeGreaterThan(50);
    const actual = mind.read().evidence.filter(e => !e.retractedAt && !e.expiredAt);
    expect(new Map(actual.map(e => [e.eventId, project(e, e.eventId)])))
      .toEqual(new Map(expected.map(e => [e.id, project(e, e.id)])));
    expect(actual).toHaveLength(expected.length);
    expect(actual.every(e => e.sourceIdentity === identity.moduleId && e.epoch === epoch && Object.keys(e.scope).length === 0)).toBe(true);
    expect(actual.some(e => e.object.kind === "execution" && e.content?.text?.includes('"terminalConfirmed":true'))).toBe(true);
  }
  function assertCurrentMessages(deleted: boolean, created?: string) {
    const expected = new Map<string, string>();
    for (const id of [main, ...(deleted ? [] : [doomed]), ...(created ? [created] : [])]) {
      for (const m of chat.get(id).messages as { id: string; text: string }[]) expected.set(objectId(id, m.id), m.text);
    }
    expect(new Map(liveMessages().map(e => [e.object.id, e.content?.text]))).toEqual(expected);
    expect(new Set(liveMessages().map(e => e.object.id)).size).toBe(liveMessages().length);
    const cp = checkpoint(), current = chat.observations.scopeTool();
    const tail = chat.observations.observations({ sourceEpoch: current.epoch, after: cp.cursor });
    expect(cp.epoch).toBe(current.epoch); expect(cp.scopeRevision).toBe(current.revision);
    expect(cp.coverage.complete).toBe(true); expect(cp.coverage.gap).toBeUndefined();
    expect(tail.coverage.complete).toBe(true); expect(tail.events).toHaveLength(0); expect(tail.hasMore).toBe(false);
    assertAuthorizedAndForgotten();
  }
  function assertDeleted() {
    const deletedEvidence = mind.read().evidence.filter(e => e.origin.rootId === doomed);
    expect(deletedEvidence.length).toBeGreaterThan(0);
    expect(deletedEvidence.every(e => e.retractedAt && !e.content)).toBe(true);
    const gone = chat.observations.snapshot({ objectRef: { kind: "conversation", id: doomed } });
    expect(gone.retracted).toBe(true); expect(gone.items).toHaveLength(0);
  }

  beforeEach(async () => {
    setSystemTime(new Date(initialTime));
    directory = mkdtempSync(join(tmpdir(), "mind-source-concurrent-"));
    chat = openChat(); mind = new CoreMindStore(join(directory, "mind"));
    service = new CoreMindService(mind, { now: () => new Date().toISOString() });
    calls = []; beforeCall = undefined;
    historical = chat.create().id; append(historical, "historical", "PRE_ENABLE_PRIVATE_TEXT");
    scope({ enabled: true });
    main = chat.create().id;
    const c = chat.get(main);
    c.messages = Array.from({ length: 54 }, (_, i) => ({
      id: `seed-${String(i).padStart(2, "0")}`, role: "user", text: `authorized seed ${i}`, attachments: [], at: initialTime,
    }));
    chat.save(c);
    chat.draft(main, { draft: "UNSUBMITTED_DRAFT_TEXT" }, chat.get(main).revision);
    doomed = chat.create().id; append(doomed, "delete-me", "authorized before deletion");
    forgotten = chat.create().id; append(forgotten, "forget-me", "FORGOTTEN_PRIVATE_TEXT");
    hidden = chat.create().id; scope({ conversationId: hidden, excluded: true });
    append(hidden, "excluded", "EXCLUDED_PRIVATE_TEXT");
    expect((await sources().sync()).status).toBe("synced");
    expect(message(main, "seed-00")?.content?.text).toBe("authorized seed 0");
    expect(message(doomed, "delete-me")).toBeDefined();
    expect(message(forgotten, "forget-me")).toBeDefined();
    service.forget({ actionKey: "forget-chat-session", expectedVisibilityRevision: mind.read().visibilityRevision,
      target: { kind: "session", sessionId: forgotten } }, owner);
    oldCursor = checkpoint().cursor;
    // Extra unconsumed old events ensure pruning advances the real source floor PAST Mind's checkpoint.
    append(main, "offline-old", "authorized offline old");
    setSystemTime(new Date(retainedTime));
    append(main, "prune-trigger", "authorized prune trigger");
    const actualGap = chat.observations.observations({ sourceEpoch: checkpoint().epoch, after: oldCursor });
    expect(actualGap.coverage.gap).toBe("retention_gap");
    expect(actualGap.coverage.complete).toBe(false); expect(actualGap.events).toHaveLength(0);
    expect(BigInt(actualGap.nextCursor)).toBeGreaterThan(BigInt(oldCursor));
    calls = [];
  });
  afterEach(() => {
    chat.db.close(); mind.close(); rmSync(directory, { recursive: true, force: true }); setSystemTime();
  });

  test("pins an authorized multi-page snapshot, then applies later creates/corrections and preserves forget across reopen", async () => {
    const pagination = gate(), delta = gate();
    let pausedInventory = false, pausedDelta = false;
    beforeCall = async entry => {
      if (entry.tool === "observation-inventory" && entry.args.snapshotToken && !pausedInventory) {
        pausedInventory = true; await pagination.pause();
      }
      if (entry.tool === "observations" && pausedInventory && !pausedDelta) {
        pausedDelta = true; await delta.pause();
      }
    };
    const work = sources().sync();
    let created = "";
    try {
      await reached(pagination, work);
      const first = calls.find(c => c.tool === "observation-inventory")!.result;
      expect(first.objects).toHaveLength(50); expect(first.hasMore).toBe(true);
      expect(checkpoint().cursor).toBe(oldCursor); expect(checkpoint().coverage.complete).toBe(false);
      expect(checkpoint().coverage.gap).toBe("source_rebuilding");
      const pinnedMessages = new Map<string, string>();
      for (const id of [main, doomed]) {
        for (const m of chat.get(id).messages as { id: string; text: string }[]) pinnedMessages.set(objectId(id, m.id), m.text);
      }
      created = chat.create().id; append(created, "new", "created during pinned inventory");
      correct(main, "seed-00", "corrected during pinned inventory");
      correct(forgotten, "forget-me", "FORGOTTEN_PRIVATE_TEXT corrected during inventory");
      append(forgotten, "new-forgotten", "FORGOTTEN_PRIVATE_TEXT newly submitted");
      pagination.release();
      await reached(delta, work);
      // Mind has committed the exact old high-water snapshot, and has not consumed the later feed yet.
      expect(checkpoint().cursor).toBe(first.highWaterCursor); expect(checkpoint().coverage.complete).toBe(true);
      expect(message(main, "seed-00")?.object.revision).toBe(1);
      expect(message(main, "seed-00")?.content?.text).toBe("authorized seed 0");
      expect(message(main, "offline-old")?.content?.text).toBe("authorized offline old");
      expect(message(main, "prune-trigger")?.content?.text).toBe("authorized prune trigger");
      expect(message(created, "new")).toBeUndefined();
      expect(new Map(liveMessages().map(e => [e.object.id, e.content?.text]))).toEqual(pinnedMessages);
      expect(liveMessages()).toHaveLength(pinnedMessages.size);
      const inventory = calls.filter(c => c.tool === "observation-inventory");
      expect(inventory).toHaveLength(2);
      for (const page of inventory) {
        expect(page.result.snapshotToken).toBe(first.snapshotToken);
        expect(page.result.highWaterCursor).toBe(first.highWaterCursor);
        expect(page.result.scopeRevision).toBe(first.scopeRevision);
      }
      expect(calls.filter(c => c.tool === "snapshot").length).toBeGreaterThan(50);
      expect(calls.filter(c => c.tool === "snapshot").every(c => c.args.snapshotToken === first.snapshotToken)).toBe(true);
      expect(calls.filter(c => c.tool === "snapshot").flatMap(c => c.result.items)
        .every(e => BigInt(e.cursor) <= BigInt(first.highWaterCursor))).toBe(true);
      assertMatchesSnapshot(first.snapshotToken, first.epoch);
      assertAuthorizedAndForgotten();
      delta.release();
      const result = await work;
      expect(result.status).toBe("synced"); expect(result.rebuilt).toBe(true);
      expect(message(main, "seed-00")?.object.revision).toBe(2);
      expect(message(main, "seed-00")?.content?.text).toBe("corrected during pinned inventory");
      expect(BigInt(checkpoint().cursor)).toBeGreaterThan(BigInt(first.highWaterCursor));
      expect(calls.some(c => c.tool === "observations" && c.args.after === first.highWaterCursor && c.result.events.length > 0)).toBe(true);
      for (const evidence of [message(main, "seed-00")!, message(created, "new")!]) {
        expect(BigInt(evidence.cursor)).toBeGreaterThan(BigInt(first.highWaterCursor));
        expect(calls.filter(c => c.tool === "observations").flatMap(c => c.result.events)
          .some(e => e.id === evidence.eventId && e.object.id === evidence.object.id)).toBe(true);
      }
      assertCurrentMessages(false, created);
    } finally { pagination.release(); delta.release(); await work; }
    beforeCall = undefined;
    // A subsequent deletion and replay must purge the previously admitted snippets too.
    chat.delete(doomed, true);
    expect((await sources().sync()).status).toBe("synced"); assertDeleted();
    reopen(); append(main, "after-reopen", "authorized after reopen");
    append(forgotten, "after-reopen", "FORGOTTEN_PRIVATE_TEXT after reopen");
    expect((await sources().sync()).status).toBe("synced");
    assertCurrentMessages(true, created); assertDeleted();
  }, 15000);

  test.each(["scope_changed", "snapshot_expired"] as const)(
    "%s explicitly rejects a paginated token, restarts inventory, and cannot resurrect deleted or forgotten Chat facts",
    async expectedCode => {
      const pagination = gate(); let paused = false;
      beforeCall = async entry => {
        if (entry.tool === "observation-inventory" && entry.args.snapshotToken && !paused) {
          paused = true; await pagination.pause();
        }
      };
      const work = sources().sync(); let created = "";
      try {
        await reached(pagination, work);
        const first = calls.find(c => c.tool === "observation-inventory")!.result;
        expect(first.objects).toHaveLength(50); expect(first.hasMore).toBe(true);
        expect(checkpoint().cursor).toBe(oldCursor); expect(checkpoint().coverage.complete).toBe(false);
        if (expectedCode === "snapshot_expired") {
          // Reconstruct the actual Chat owner over its same SQLite DB while Mind awaits page two.
          chat.db.close(); chat = openChat();
          expect(chat.observations.scopeTool().epoch).toBe(first.epoch);
        }
        created = chat.create().id; append(created, "new", "created while invalidating inventory");
        correct(main, "seed-00", "corrected while invalidating inventory");
        correct(forgotten, "forget-me", "FORGOTTEN_PRIVATE_TEXT correction after invalidation");
        append(forgotten, "new-forgotten", "FORGOTTEN_PRIVATE_TEXT new after invalidation");
        chat.delete(doomed, true);
        expect(() => chat.observations.snapshot({ snapshotToken: first.snapshotToken,
          objectRef: { kind: "message", id: objectId(doomed, "delete-me") } })).toThrow(expectedCode);
        pagination.release();
        const result = await work;
        expect(result.status).toBe("synced"); expect(result.rebuilt).toBe(true); expect(result.unknowns).toEqual([]);
        const rejected = calls.findIndex(c => c.tool === "observation-inventory" && c.error === expectedCode);
        expect(rejected).toBeGreaterThan(0);
        expect(calls[rejected]!.args.snapshotToken).toBe(first.snapshotToken);
        const fresh = calls.slice(rejected + 1).find(c => c.tool === "observation-inventory")!;
        expect(fresh.args.snapshotToken).toBeUndefined(); expect(fresh.args.cursor).toBeUndefined();
        expect(fresh.result.snapshotToken).not.toBe(first.snapshotToken);
        expect(fresh.result.scopeRevision).toBeGreaterThan(first.scopeRevision);
        expect(BigInt(fresh.result.highWaterCursor)).toBeGreaterThan(BigInt(first.highWaterCursor));
        const snapshots = calls.filter(c => c.tool === "snapshot"); expect(snapshots.length).toBeGreaterThan(50);
        expect(snapshots.every(c => c.args.snapshotToken === fresh.result.snapshotToken)).toBe(true);
        expect(snapshots.some(c => (c.args.objectRef as { id: string }).id === objectId(doomed, "delete-me"))).toBe(false);
        expect(message(main, "seed-00")?.content?.text).toBe("corrected while invalidating inventory");
        expect(checkpoint().cursor).toBe(fresh.result.highWaterCursor);
        assertMatchesSnapshot(fresh.result.snapshotToken, fresh.result.epoch);
        assertCurrentMessages(true, created); assertDeleted();
      } finally { pagination.release(); await work; }
      beforeCall = undefined;
      const persistedCursor = checkpoint().cursor;
      reopen();
      append(main, "post-restart", "authorized delta after both stores reopen");
      append(forgotten, "post-restart", "FORGOTTEN_PRIVATE_TEXT post restart delta");
      calls = [];
      expect((await sources().sync()).status).toBe("synced");
      expect(calls.find(c => c.tool === "observations")?.args.after).toBe(persistedCursor);
      expect(calls.some(c => c.tool === "observation-inventory")).toBe(false);
      assertCurrentMessages(true, created); assertDeleted();
      // Idempotent second sync plus another retention gap exercises deletion/forget during a full later replay.
      const count = liveMessages().length;
      expect((await sources().sync()).status).toBe("synced"); expect(liveMessages()).toHaveLength(count);
      append(main, "next-offline", "authorized next offline");
      setSystemTime(new Date("2026-11-03T12:00:00.000Z"));
      append(main, "next-prune", "authorized next pruning trigger");
      expect(chat.observations.observations({ sourceEpoch: checkpoint().epoch, after: checkpoint().cursor }).coverage.gap).toBe("retention_gap");
      const replay = await sources().sync(); expect(replay.status).toBe("synced"); expect(replay.rebuilt).toBe(true);
      assertCurrentMessages(true, created); assertDeleted();
    }, 15000,
  );
});
