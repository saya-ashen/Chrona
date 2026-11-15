import {redactSensitiveText} from './core-redaction';
import { z } from "zod";
import { coreDigest, type CoreMindStore } from "./core-store";
import type { CoreAccess, IngestBatch, Scope as EvidenceScope, SourceCheckpoint } from "./core-types";

export interface ChatSource {
  moduleId: string; hash: string;
  /** Trusted adapter's permitted learning scope; source JSON cannot grant scope. */
  scope?: EvidenceScope;
  /** Trusted runtime verified stable IDs/retraction mappings; never copied from source tool JSON. */
  identityContinuityVerified?: boolean;
}
export type SourceCall = (target: { moduleId: string; tool: string }, input: Record<string, unknown>) => Promise<unknown>;
export type ResolveSource = (name: "chat") => ChatSource | undefined | Promise<ChatSource | undefined>;
/** The trusted service owns deduplication, object tombstones, and the checkpoint transaction. */
export interface SourceIngestor { ingest(batch: IngestBatch, access: CoreAccess): unknown }
export interface SourceSyncResult {
  status: "synced" | "disabled" | "paused" | "unavailable" | "blocked" | "degraded";
  source?: ChatSource; checkpoint?: SourceCheckpoint;
  coverage: SourceCheckpoint["coverage"];
  pages: number; ingested: number; rebuilt: boolean; unknowns: string[];
}

const text = z.string().max(2048);
const cursor = z.string().regex(/^(0|[1-9][0-9]*)$/).max(40);
const revision = z.number().int().nonnegative();
const objectRef = z.object({ kind: text.min(1), id: text.min(1), revision });
const sourceSchema = z.object({ moduleId: text.min(1), hash: text.min(1), epoch: text.min(1) });
const coverageSchema = z.object({ complete: z.boolean(), oldestAvailableCursor: cursor.optional(), gap: text.optional() });
/** Persisted provenance stamped after Chat identity verification, never accepted from source JSON. */
export function isChatEvidence(event: object): boolean {
  return "sourceKind" in event && event.sourceKind === "chat";
}
const eventSchema = z.object({
  id: text.min(1), cursor, object: objectRef,
  kind: z.enum(["message", "operation", "result", "correction", "retract", "scope-change"]),
  actor: z.enum(["user", "assistant", "application"]),
  origin: z.object({ rootId: text.min(1), parentId: text.optional(), pursuitId: text.optional(), runId: text.optional() }),
  occurredAt: text.min(1), receivedAt: text.min(1), scopeRevision: revision,
  content: z.object({ text: z.string().max(32768).optional(), artifactRefs: z.array(text).max(50).optional(), truncated: z.boolean() }).optional(),
});
const feedSchema = z.object({
  source: sourceSchema, events: z.array(eventSchema).max(50), nextCursor: cursor,
  hasMore: z.boolean(), coverage: coverageSchema, capturedAt: text.min(1), scopeRevision: revision,
});
const scopeSchema = z.object({ epoch: text.min(1), revision, enabled: z.boolean(), startCursor: cursor });
const inventorySchema = z.object({
  source: sourceSchema, objects: z.array(objectRef).max(50), snapshotToken: text.min(1),
  epoch: text.min(1), scopeRevision: revision, highWaterCursor: cursor,
  nextCursor: cursor, hasMore: z.boolean(), coverage: coverageSchema,
});
const snapshotSchema = z.object({
  source: sourceSchema, objectRef, currentRevision: revision.nullable(), retracted: z.boolean(),
  items: z.array(eventSchema).max(50), nextCursor: z.string().max(4096), hasMore: z.boolean(),
  scopeRevision: revision, coverage: coverageSchema,
});
type Event = z.infer<typeof eventSchema>;
type Ref = z.infer<typeof objectRef>;
type Inventory = z.infer<typeof inventorySchema>;
type Scope = z.infer<typeof scopeSchema>;
const PAGE = { limit: 50, maxBytes: 32768 };
// Exhausting a bound is a visible incomplete sync, never successful coverage.
const MAX_PAGES = 512;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 16384;
const INGEST_BYTES = 60000;
const ACCESS: CoreAccess = { subject: "mind:sources", role: "runtime", scopes: [{}] };
const RESTARTABLE = new Set(["scope_changed", "snapshot_expired", "epoch_changed", "revision_changed"]);
const SAFE_CODES = new Set([...RESTARTABLE, "FORBIDDEN", "CONFLICT", "RESTORE_BLOCKED", "CAPACITY", "NOT_FOUND"]);
const RESUMABLE = new Set(["page_budget_exceeded", "response_budget_exceeded", "source_call_failed", "FORBIDDEN"]);
class SourceFailure extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(code: string): never { throw new SourceFailure(code); }
const key = (ref: Pick<Ref, "kind" | "id">) => JSON.stringify([ref.kind, ref.id]);
function boundedText(value: string): { value: string; truncated: boolean } {
  if (Buffer.byteLength(value) <= MAX_TEXT_BYTES) return { value, truncated: false };
  // Drop a potentially incomplete trailing UTF-8 codepoint.
  const bytes = Buffer.from(value); let end = MAX_TEXT_BYTES;
  while ((bytes[end]! & 0xc0) === 0x80) end--;
  return { value: bytes.subarray(0, end).toString("utf8"), truncated: true };
}

/** Pure Chat reads only. The runtime resolves identity and constructs the call adapter. */
export class CoreSources {
  private pending?: Promise<SourceSyncResult>;
  constructor(
    private readonly store: Pick<CoreMindStore, "read">,
    private readonly service: SourceIngestor,
    private readonly call: SourceCall,
    private readonly resolveSource: ResolveSource,
  ) {}

  sync(): Promise<SourceSyncResult> {
    // An instance cannot race itself; independent instances still use checkpoint CAS.
    if (this.pending) return this.pending;
    const pending = this.run(); this.pending = pending;
    const clear = () => { if (this.pending === pending) this.pending = undefined; };
    void pending.then(clear, clear);
    return pending;
  }

  private async run(): Promise<SourceSyncResult> {
    const result: SourceSyncResult = { status: "degraded", pages: 0, ingested: 0, rebuilt: false,
      coverage: { complete: false, gap: "not_synced" }, unknowns: [] };
    let identity: string | undefined;
    let bytes = 0;
    let rebuilding = false;
    const checkpoint = (sourceIdentity = identity) => this.store.read().checkpoints.find(cp => cp.sourceIdentity === sourceIdentity);
    const guard = () => {
      const state = this.store.read();
      if (state.settings.restoreBlocked !== false) fail("RESTORE_BLOCKED");
      if (!state.settings.enabled || !state.settings.learningEnabled) fail("learning_paused");
    };
    const read = async <T>(tool: string, input: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> => {
      guard();
      if (++result.pages > MAX_PAGES) fail("page_budget_exceeded");
      let response: unknown;
      try { response = await this.call({ moduleId: result.source!.moduleId, tool }, input); }
      catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        console.error(JSON.stringify({ component: 'mind', event: 'source_call_failed', tool, error: /^[a-zA-Z_]{1,64}$/.test(code) ? code : 'unclassified source call error' }));
        fail(SAFE_CODES.has(code) ? code : "source_call_failed");
      }
      // Adapter normally unwraps SDK JSON. Supporting the envelope also makes failures explicit.
      if (response && typeof response === "object" && "json" in response && typeof response.json === "string") {
        if (Buffer.byteLength(response.json) > PAGE.maxBytes + 16384) fail("response_too_large");
        try { response = JSON.parse(response.json); } catch { fail("invalid_source_response"); }
      }
      if (response && typeof response === "object" && "error" in response) {
        const error = response.error;
        const code = typeof error === "string" ? error : error && typeof error === "object" && "code" in error ? String(error.code) : "";
        fail(SAFE_CODES.has(code) ? code : "source_call_failed");
      }
      let size: number;
      try { size = Buffer.byteLength(JSON.stringify(response) ?? ""); } catch { fail("invalid_source_response"); }
      bytes += size!;
      if (size! > PAGE.maxBytes + 16384 || bytes > MAX_BYTES) fail("response_budget_exceeded");
      const parsed = schema.safeParse(response);
      if (!parsed.success) fail("invalid_source_response");
      guard();
      return parsed.data!;
    };
    const verify = (source: z.infer<typeof sourceSchema>) => {
      if (source.moduleId !== result.source!.moduleId || source.hash !== result.source!.hash) fail("source_identity_mismatch");
    };
    const ingest = async (batch: Omit<IngestBatch, "sourceIdentity" | "expectedCheckpointRevision">, expected = checkpoint(), sourceIdentity = identity!) => {
      guard();
      await this.service.ingest({ ...batch, identityContinuityVerified: result.source?.identityContinuityVerified === true,
        sourceIdentity, expectedCheckpointRevision: expected?.revision ?? 0 }, ACCESS);
      const saved = checkpoint(sourceIdentity);
      // Chain only our own transaction revision. Never adopt a competing writer after an await.
      if (!saved || saved.revision !== (expected?.revision ?? 0) + 1 || saved.epoch !== batch.epoch || saved.cursor !== batch.nextCursor) fail("CONFLICT");
      result.ingested += batch.events.length;
      result.checkpoint = saved; result.coverage = saved.coverage;
      return saved;
    };
    const invalidate = async (reason: string, sourceIdentity = identity) => {
      const cp = checkpoint(sourceIdentity);
      if (!cp || (!cp.coverage.complete && cp.coverage.gap === reason)) return;
      // Service reads/derived evidence must fail closed while this source is incomplete.
      await ingest({ epoch: cp.epoch, nextCursor: cp.cursor, scopeRevision: cp.scopeRevision,
        capturedAt: new Date().toISOString(), coverage: { ...cp.coverage, complete: false, gap: reason }, events: [] }, cp, cp.sourceIdentity);
    };
    const invalidateKnownChatCoverage = async (): Promise<boolean> => {
      // A missing resolver result cannot identify arbitrary checkpoint owners. The marker was
      // stamped only after Chat identity verification and is retained in persisted evidence.
      const chatIdentities = new Set(this.store.read().evidence.filter(isChatEvidence).map(evidence => evidence.sourceIdentity));
      let invalidated = true;
      for (const sourceIdentity of chatIdentities) {
        try { await invalidate("source_unavailable", sourceIdentity); }
        catch {
          console.error("[mind.core-sources]", { code: "coverage_invalidation_failed" });
          invalidated = false;
        }
      }
      return invalidated;
    };
    const permittedScope = (): EvidenceScope => ({ ...(result.source?.scope ?? {}) });
    const convert = (event: Event): IngestBatch["events"][number] => {
      const content = event.content ? { ...event.content, text: event.content.text ?? "", artifactRefs: event.content.artifactRefs ?? [] } : undefined;
      if (content?.text !== undefined) {
        const bounded = boundedText(content.text); content.text = bounded.value; content.truncated ||= bounded.truncated;
      }
      // Chat's opt-in feed already omits private/excluded conversations. Its root is
      // provenance, while authenticated restrictions bound the model's scope judgment.
      const converted = { ...event, eventId: event.id, sourceKind: "chat", scope: permittedScope(), content };
      // Decoded UTF-8 size alone misses JSON expansion (e.g. NUL becomes six bytes).
      if (content?.text !== undefined && Buffer.byteLength(JSON.stringify(converted)) > INGEST_BYTES - 2) {
        const original = content.text; let low = 0; let high = Buffer.byteLength(original);
        content.truncated = true;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2); const buf = Buffer.from(original); let end = mid;
          while (end < buf.length && (buf[end]! & 0xc0) === 0x80) end--;
          content.text = buf.subarray(0, end).toString("utf8");
          if (Buffer.byteLength(JSON.stringify(converted)) <= INGEST_BYTES - 2) low = mid; else high = mid - 1;
        }
        const buf = Buffer.from(original); let end = low;
        while (end < buf.length && (buf[end]! & 0xc0) === 0x80) end--;
        content.text = buf.subarray(0, end).toString("utf8");
      }
      if (Buffer.byteLength(JSON.stringify(converted)) > INGEST_BYTES - 2) fail("event_too_large");
      return converted;
    };
    const readObject = async (ref: Ref, epoch: string, scopeRevision: number, snapshotToken?: string, highWater?: string) => {
      let after: string | undefined;
      const positions = new Set<string>([""]);
      const items = new Map<string, { event: Event; overflow: boolean }>();
      do {
        const snap = await read("snapshot", { ...PAGE, objectRef: ref, expectedRevision: ref.revision,
          ...(snapshotToken ? { snapshotToken } : {}), ...(after !== undefined ? { cursor: after } : {}) }, snapshotSchema);
        verify(snap.source);
        if (snap.source.epoch !== epoch || snap.scopeRevision !== scopeRevision) fail("scope_changed");
        if (snap.retracted) fail("scope_changed");
        if (key(snap.objectRef) !== key(ref) || snap.currentRevision !== ref.revision) fail("revision_changed");
        if (!snap.coverage.complete || snap.coverage.gap) fail("snapshot_incomplete");
        for (const event of snap.items) {
          if (key(event.object) !== key(ref) || event.object.revision !== ref.revision || event.scopeRevision > scopeRevision || (highWater !== undefined && BigInt(event.cursor) > BigInt(highWater))) fail("inconsistent_snapshot");
          const previous = items.get(event.id);
          if (previous && coreDigest({ ...previous.event, content: undefined }) !== coreDigest({ ...event, content: undefined })) fail("inconsistent_snapshot");
          const combined = boundedText((previous?.event.content?.text ?? "") + (event.content?.text ?? ""));
          const overflow = !!previous?.overflow || combined.truncated;
          // Paging truncation describes fragments; the completed representation is truncated only by our own content bound.
          const content = event.content || previous?.event.content ? {
            text: combined.value, truncated: overflow,
            artifactRefs: [...new Set([...(previous?.event.content?.artifactRefs ?? []), ...(event.content?.artifactRefs ?? [])])],
          } : undefined;
          items.set(event.id, { event: { ...event, content }, overflow });
        }
        if (snap.hasMore && (!snap.nextCursor || positions.has(snap.nextCursor) || !snap.items.length)) fail("non_advancing_snapshot");
        positions.add(snap.nextCursor); after = snap.nextCursor;
        if (!snap.hasMore) break;
      } while (true);
      return [...items.values()].map(({ event }) => convert(event));
    };
    const retract = (ref: Ref, epoch: string, atCursor: string, scopeRevision: number, rootId: string): IngestBatch["events"][number] => {
      const now = new Date().toISOString();
      const eventId = `inventory-retract:${coreDigest([epoch, atCursor, scopeRevision, ref.kind, ref.id])}`;
      return { id: eventId, eventId, cursor: atCursor, object: ref, kind: "retract", actor: "application",
        scope: permittedScope(), origin: { rootId }, occurredAt: now, receivedAt: now, scopeRevision };
    };
    const rebuild = async (): Promise<void> => {
      result.rebuilt = true; rebuilding = true;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const cp = checkpoint();
          let first: Inventory | undefined; let position: string | undefined;
          const refs = new Map<string, Ref>();
          do {
            const page = await read("observation-inventory", { ...PAGE, ...(first ? { snapshotToken: first.snapshotToken, cursor: position } : {}) }, inventorySchema);
            verify(page.source);
            if (!page.coverage.complete || page.coverage.gap) fail("inventory_incomplete");
            if (page.epoch !== page.source.epoch) fail("inconsistent_inventory");
            if (!first) first = page;
            if (page.snapshotToken !== first.snapshotToken || page.epoch !== first.epoch || page.scopeRevision !== first.scopeRevision || page.highWaterCursor !== first.highWaterCursor) fail("inconsistent_inventory");
            for (const ref of page.objects) {
              if (refs.has(key(ref))) fail("duplicate_inventory_object");
              refs.set(key(ref), ref);
            }
            if (page.hasMore && (BigInt(page.nextCursor) <= BigInt(position ?? "0") || !page.objects.length)) fail("non_advancing_inventory");
            position = page.nextCursor;
            if (!page.hasMore) break;
          } while (true);
          const view = first!;
          if (cp && cp.epoch !== view.epoch && !result.source?.identityContinuityVerified) fail("RESTORE_BLOCKED");
          const events = new Map<string, IngestBatch["events"][number]>();
          for (const ref of refs.values()) {
            for (const event of await readObject(ref, view.epoch, view.scopeRevision, view.snapshotToken, view.highWaterCursor)) {
              if (events.has(event.eventId)) fail("duplicate_snapshot_event");
              events.set(event.eventId, event);
            }
          }
          // A final guard detects scope/epoch changes even when the inventory is empty.
          const scope = await read("observation-scope", {}, scopeSchema);
          if (!scope.enabled || scope.epoch !== view.epoch || scope.revision !== view.scopeRevision) fail("scope_changed");
          const old = this.store.read().evidence.filter(e => e.sourceIdentity === identity && !e.retractedAt);
          const missing = new Map<string, typeof old[number]>();
          for (const evidence of old) if (!refs.has(key(evidence.object))) missing.set(key(evidence.object), evidence);
          for (const evidence of missing.values()) {
            const event = retract(evidence.object, view.epoch, view.highWaterCursor, view.scopeRevision, evidence.origin.rootId);
            events.set(event.eventId, event);
          }
          const all = [...events.values()];
          const chunks: IngestBatch["events"][] = []; let chunk: IngestBatch["events"] = []; let chunkBytes = 2;
          for (const event of all) {
            const eventBytes = Buffer.byteLength(JSON.stringify(event)) + 1;
            if (eventBytes > INGEST_BYTES) fail("event_too_large");
            if (chunk.length === 50 || chunkBytes + eventBytes > INGEST_BYTES) { chunks.push(chunk); chunk = []; chunkBytes = 2; }
            chunk.push(event); chunkBytes += eventBytes;
          }
          chunks.push(chunk);
          let expected = cp;
          // Stage with an incomplete checkpoint and unchanged cursor. Only the final transaction
          // exposes the consistent set and advances the watermark. Replays remain service-idempotent.
          for (let index = 0; index < chunks.length; index++) {
            const final = index === chunks.length - 1;
            if (final && chunks.length > 1) {
              const current = await read("observation-scope", {}, scopeSchema);
              if (!current.enabled || current.epoch !== view.epoch || current.revision !== view.scopeRevision) fail("scope_changed");
            }
            expected = await ingest({ epoch: view.epoch, nextCursor: final ? view.highWaterCursor : cp?.cursor ?? "0", scopeRevision: view.scopeRevision,
              capturedAt: new Date().toISOString(), coverage: final ? view.coverage : { complete: false, gap: "source_rebuilding" }, events: chunks[index]! }, expected);
          }
          rebuilding = false;
          return;
        } catch (error) {
          if (error instanceof SourceFailure && RESTARTABLE.has(error.code) && attempt < 2) continue;
          throw error;
        }
      }
    };
    try {
      guard();
      let source: ChatSource | undefined;
      try { source = await this.resolveSource("chat"); }
      catch { fail("source_unavailable"); }
      if (!source || !source.moduleId || !source.hash) fail("source_unavailable");
      result.source = source;
      // Keep identity stable across application upgrades and data epochs for object tombstones.
      identity = source.moduleId;
      let scope: Scope = await read("observation-scope", {}, scopeSchema);
      let cp = checkpoint();
      if (!scope.enabled) {
        if (cp) {
          const seen = new Set<string>(); const events: IngestBatch["events"] = [];
          for (const evidence of this.store.read().evidence) if (evidence.sourceIdentity === identity && !evidence.retractedAt && !seen.has(key(evidence.object))) {
            seen.add(key(evidence.object)); events.push(retract(evidence.object, scope.epoch, cp.cursor, scope.revision, evidence.origin.rootId));
          }
          await invalidate("source_disabled");
          // Large withdrawals obey the same per-transaction bound as ordinary feed pages.
          for (let offset = 0; offset < Math.max(1, events.length); offset += 50) {
            await ingest({ epoch: cp.epoch, nextCursor: cp.cursor, scopeRevision: scope.revision,
              capturedAt: new Date().toISOString(), coverage: { complete: false, gap: "source_disabled" }, events: events.slice(offset, offset + 50) });
          }
        }
        result.status = "disabled"; result.coverage = { complete: false, gap: "source_disabled" }; result.unknowns = ["source_disabled"]; return result;
      }
      if (!cp) {
        // Installation/re-enablement is a visible source watermark, never an implicit historical scan.
        await ingest({ epoch: scope.epoch, nextCursor: scope.startCursor, scopeRevision: scope.revision,
          capturedAt: new Date().toISOString(), coverage: { complete: true }, events: [] });
      } else if (cp.epoch !== scope.epoch || cp.scopeRevision !== scope.revision || ((!cp.coverage.complete || cp.coverage.gap) && !RESUMABLE.has(cp.coverage.gap ?? ""))) {
        await invalidate("source_rebuilding"); await rebuild();
      }
      for (;;) {
        cp = checkpoint();
        if (!cp) fail("checkpoint_missing");
        const page = await read("observations", { ...PAGE, sourceEpoch: cp.epoch, after: cp.cursor }, feedSchema);
        verify(page.source);
        if (page.source.epoch !== cp.epoch || page.scopeRevision !== cp.scopeRevision || !page.coverage.complete || page.coverage.gap) {
          await invalidate("source_rebuilding"); await rebuild(); continue;
        }
        if (BigInt(page.nextCursor) < BigInt(cp.cursor) || (page.hasMore && BigInt(page.nextCursor) <= BigInt(cp.cursor))) fail("non_advancing_feed");
        let last = BigInt(cp.cursor);
        for (const event of page.events) {
          if (event.scopeRevision > page.scopeRevision || BigInt(event.cursor) <= last || BigInt(event.cursor) > BigInt(page.nextCursor)) fail("inconsistent_feed");
          last = BigInt(event.cursor);
        }
        const events: IngestBatch["events"] = [];
        try {
          for (const event of page.events) {
            if (event.content?.truncated) {
              const current = await readObject(event.object, page.source.epoch, page.scopeRevision);
              const hydrated = current.find(e => e.eventId === event.id);
              if (!hydrated) fail("revision_changed");
              events.push(hydrated);
            } else events.push(convert(event));
          }
        } catch (error) {
          if (error instanceof SourceFailure && RESTARTABLE.has(error.code)) {
            await invalidate("source_rebuilding"); await rebuild(); continue;
          }
          throw error;
        }
        // Validate the live scope after awaiting the feed, before making its contents visible.
        scope = await read("observation-scope", {}, scopeSchema);
        if (!scope.enabled || scope.epoch !== page.source.epoch || scope.revision !== page.scopeRevision) {
          await invalidate("source_rebuilding"); await rebuild(); continue;
        }
        await ingest({ epoch: page.source.epoch, nextCursor: page.nextCursor, scopeRevision: page.scopeRevision,
          capturedAt: page.capturedAt, coverage: page.coverage, events }, cp);
        if (!page.hasMore) break;
      }
      result.status = "synced"; result.checkpoint = checkpoint(); result.coverage = result.checkpoint!.coverage;
      return result;
    } catch (error) {
      const externalCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      const code = error instanceof SourceFailure ? error.code : SAFE_CODES.has(externalCode) ? externalCode : "source_sync_failed";
      // No exception message, arguments, user content, or source-owned error text is logged.
      console.error(JSON.stringify({ component: 'mind', event: 'source_sync_failed', error: code }));
      result.status = code === "RESTORE_BLOCKED" ? "blocked" : code === "learning_paused" ? "paused" : code === "source_call_failed" || code === "source_unavailable" || code === "FORBIDDEN" ? "unavailable" : "degraded";
      result.unknowns = [code]; result.coverage = { complete: false, gap: code };
      if (code === "source_unavailable" && !identity) {
        if (!await invalidateKnownChatCoverage()) result.unknowns.push("coverage_invalidation_failed");
        result.coverage = { complete: false, gap: code };
      } else if (identity && code !== "RESTORE_BLOCKED" && code !== "learning_paused" && code !== "CONFLICT") {
        try { await invalidate(rebuilding ? "source_rebuilding" : code); }
        catch { console.error("[mind.core-sources]", { code: "coverage_invalidation_failed" }); result.unknowns.push("coverage_invalidation_failed"); }
      }
      result.checkpoint = identity ? checkpoint() : undefined;
      return result;
    }
  }
}

/** Applications report only their own bounded operations. Identity/version come from the routed caller. */
const operationReport = z.object({eventId:z.string().trim().min(1).max(128),operation:z.string().trim().min(1).max(200),outcome:z.enum(['succeeded','failed','unknown']),detail:z.string().max(2000).optional(),page:z.string().max(500).optional()}).strict();
export function ingestApplicationOperation(
 store:CoreMindStore,service:SourceIngestor,caller:{moduleId:string;hash:string},input:unknown,at=new Date().toISOString(),
){
 const report=operationReport.parse(input),sourceIdentity=`application:${caller.moduleId}`;
 const text=redactSensitiveText(JSON.stringify({...report,applicationId:caller.moduleId,applicationVersion:caller.hash}),Number.MAX_SAFE_INTEGER);
 const content={text,truncated:false};
 const state=store.read(),previous=state.evidence.find(e=>e.sourceIdentity===sourceIdentity&&e.eventId===report.eventId);
 if(previous){if(previous.retractedAt||previous.expiredAt)throw Error('Operation report was withdrawn or expired');if(previous.content?.text!==content.text)throw Error('Operation event identity already used with different content');return {accepted:true,eventId:report.eventId};}
 const checkpoint=state.checkpoints.find(c=>c.sourceIdentity===sourceIdentity),cursor=String(BigInt(checkpoint?.cursor??'0')+1n);
 service.ingest({sourceIdentity,epoch:'application-operations-v1',expectedCheckpointRevision:checkpoint?.revision??0,nextCursor:cursor,scopeRevision:0,capturedAt:at,coverage:{complete:true},events:[{
  id:report.eventId,eventId:report.eventId,cursor,object:{kind:'operation',id:report.eventId,revision:1},kind:'operation',scope:{},actor:'application',origin:{rootId:report.eventId},occurredAt:at,receivedAt:at,scopeRevision:0,content,sourceKind:'application',
 } as IngestBatch['events'][number]]},ACCESS);
 return {accepted:true,eventId:report.eventId};
}
