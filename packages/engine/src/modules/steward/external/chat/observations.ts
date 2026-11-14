import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

type Ref = { kind: string; id: string; revision?: number };
type Source = { moduleId: string; hash: string; epoch: string };
type View = { epoch: string; scopeRevision: number; highWaterCursor: string; expires: number; objects: any[] };
const stamp = () => new Date().toISOString();
const bytes = (value: any) => Buffer.byteLength(JSON.stringify(value));
const fail = (code: string, message = code): never => { throw Object.assign(Error(message), { code }); };
export function utf8Prefix(text: string, max: number) {
  const buf = Buffer.from(text); let end = Math.min(buf.length, Math.max(0, max));
  while (end > 0 && end < buf.length && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}
function bounds(a: any) {
  const limit = a.limit ?? 50, maxBytes = a.maxBytes ?? 32768;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 32768) fail('invalid', 'limit 1..50; maxBytes 1..32768');
  return { limit, maxBytes };
}
function position(value: any = '') {
  if (value === '') return 0;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) fail('invalid', 'invalid cursor');
  return Number(value);
}
export const objectId = (conversationId: string, localId: string) => JSON.stringify([conversationId, localId]);

/** Private source ledger. All writes run inside Store's main-record transaction.
 * Read methods never reconcile a Run or write SQLite. Inventory views are ephemeral,
 * expire after five minutes/restart, and are invalidated by any visibility change.
 * Content-bearing event history lasts 30 days; current objects live with Chat.
 * Withdrawal removes logical copies here, not WAL/backup forensic bytes.
 */
export class Observations {
  private views = new Map<string, View>();
  constructor(private db: Database, private identity: () => { moduleId: string; hash: string }) {
    db.run('CREATE TABLE IF NOT EXISTS observation_meta (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS observation_scopes (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.run('CREATE TABLE IF NOT EXISTS observation_objects (kind TEXT, id TEXT, conversation_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id))');
    db.run('CREATE TABLE IF NOT EXISTS observation_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT, value TEXT NOT NULL, at TEXT NOT NULL)');
    db.run('CREATE INDEX IF NOT EXISTS observation_events_conversation ON observation_events(conversation_id)');
    db.run('CREATE TABLE IF NOT EXISTS observation_withdrawals (kind TEXT, id TEXT, PRIMARY KEY(kind,id))');
    if (!db.query('SELECT id FROM observation_meta WHERE id=1').get()) db.query('INSERT INTO observation_meta VALUES (1,?)').run(JSON.stringify({ epoch: randomUUID(), revision: 0, enabled: false, enabledAt: null, startCursor: '0', floor: 0 }));
  }
  private meta(): any { return JSON.parse((this.db.query('SELECT value FROM observation_meta WHERE id=1').get() as any).value); }
  private setMeta(m: any) { this.db.query('UPDATE observation_meta SET value=? WHERE id=1').run(JSON.stringify(m)); }
  private source(): Source { return { ...this.identity(), epoch: this.meta().epoch }; }
  private high() { return Number((this.db.query("SELECT seq FROM sqlite_sequence WHERE name='observation_events'").get() as any)?.seq ?? 0); }
  private scope(id: string): any { const row: any = this.db.query('SELECT value FROM observation_scopes WHERE id=?').get(id); return row ? JSON.parse(row.value) : { id, excluded: false, private: false }; }
  allowed(id: string) { const m = this.meta(), s = this.scope(id); return m.enabled && !s.excluded && !s.private; }
  admission(id: string) { const m = this.meta(); return this.allowed(id) ? JSON.stringify([m.epoch, m.generation ?? 0, this.scope(id).revision ?? 0]) : null; }
  private objects() { return (this.db.query('SELECT value FROM observation_objects ORDER BY kind,id').all() as any[]).map(r => JSON.parse(r.value)); }
  private executionRevision(id: string, previous = 0) {
    // Persist the execution watermark beyond content retention and scope withdrawal.
    const scope = this.scope(id);
    scope.executionRevision = Math.max(scope.executionRevision ?? 0, previous) + 1;
    this.db.query('INSERT OR REPLACE INTO observation_scopes VALUES (?,?)').run(id, JSON.stringify(scope));
    return scope.executionRevision;
  }
  private append(conversationId: string | null, event: any) {
    const m = this.meta(), at = stamp();
    const seq = Number(this.db.query('INSERT INTO observation_events(conversation_id,value,at) VALUES (?,?,?)').run(conversationId, '{}', at).lastInsertRowid);
    const full = { ...event, id: `${m.epoch}:${seq}`, cursor: String(seq), receivedAt: at, scopeRevision: m.revision };
    this.db.query('UPDATE observation_events SET value=? WHERE seq=?').run(JSON.stringify(full), seq);
    return full;
  }
  private put(conversationId: string, ref: Ref, event: any) {
    if (this.db.query('SELECT id FROM observation_withdrawals WHERE kind=? AND id=?').get(ref.kind, ref.id)) return;
    const row: any = this.db.query('SELECT value FROM observation_objects WHERE kind=? AND id=?').get(ref.kind, ref.id);
    const old = row ? JSON.parse(row.value) : null;
    const signature = JSON.stringify(event);
    if (old?.signature === signature) return;
    const revision = ref.kind === 'execution' ? this.executionRevision(conversationId, old?.object.revision) : (old?.object.revision ?? 0) + 1;
    const full = this.append(conversationId, { ...event, ...(old && ref.kind === 'message' ? { kind: 'correction', retracts: [old.id] } : {}), object: { ...ref, revision } });
    this.db.query('INSERT OR REPLACE INTO observation_objects VALUES (?,?,?,?)').run(ref.kind, ref.id, conversationId, JSON.stringify({ ...full, signature }));
  }
  private publicObject(value: any) { const { signature, ...event } = value; return event; }
  private withdraw(conversationId?: string) {
    const rows = conversationId === undefined ? this.db.query('SELECT kind,id,conversation_id,value FROM observation_objects').all() : this.db.query('SELECT kind,id,conversation_id,value FROM observation_objects WHERE conversation_id=?').all(conversationId);
    for (const row of rows as any[]) {
      const old = JSON.parse(row.value);
      this.db.query('INSERT OR IGNORE INTO observation_withdrawals VALUES (?,?)').run(row.kind, row.id);
      const revision = row.kind === 'execution' ? this.executionRevision(row.conversation_id, old.object.revision) : old.object.revision + 1;
      this.append(row.conversation_id, { object: { kind: row.kind, id: row.id, revision }, kind: 'retract', occurredAt: stamp(), actor: 'application', origin: { rootId: row.conversation_id }, retracts: [old.id] });
    }
    // Purge all old fragments, including versions no longer current. Replay cannot revive them.
    const events = conversationId === undefined ? this.db.query('SELECT seq,value FROM observation_events').all() : this.db.query('SELECT seq,value FROM observation_events WHERE conversation_id=?').all(conversationId);
    for (const row of events as any[]) {
      const event = JSON.parse(row.value);
      if (event.content) { delete event.content; event.kind = 'retract'; event.retracts = [event.id]; this.db.query('UPDATE observation_events SET value=? WHERE seq=?').run(JSON.stringify(event), row.seq); }
    }
    if (conversationId === undefined) this.db.run('DELETE FROM observation_objects');
    else this.db.query('DELETE FROM observation_objects WHERE conversation_id=?').run(conversationId);
  }
  scopeTool(a: any = {}) {
    const mutation = ['enabled', 'excluded', 'private'].some(k => k in a);
    if (!mutation) { const m = this.meta(); return { ...m, ...(a.conversationId ? { conversation: this.scope(a.conversationId) } : {}) }; }
    return this.db.transaction(() => {
      const m = this.meta();
      if (a.expectedRevision !== m.revision) fail('conflict', '学习范围已更新，请重新读取');
      for (const key of ['enabled', 'excluded', 'private']) if (key in a && typeof a[key] !== 'boolean') fail('invalid');
      if (('excluded' in a || 'private' in a) && !a.conversationId) fail('invalid', 'conversationId required');
      if (a.conversationId && !this.db.query('SELECT id FROM conversations WHERE id=?').get(a.conversationId)) fail('not_found');
      const oldScope = a.conversationId ? this.scope(a.conversationId) : null;
      const next = oldScope ? { ...oldScope, ...('excluded' in a ? { excluded: a.excluded } : {}), ...('private' in a ? { private: a.private } : {}) } : null;
      const changed = ('enabled' in a && a.enabled !== m.enabled) || (next && JSON.stringify(next) !== JSON.stringify(oldScope));
      if (!changed) return { ...m, ...(next ? { conversation: next } : {}) };
      m.revision++;
      if ('enabled' in a && a.enabled !== m.enabled) { m.enabled = a.enabled; m.generation = (m.generation ?? 0) + 1; m.startCursor = String(this.high()); m.enabledAt = m.enabled ? stamp() : null; }
      this.setMeta(m);
      if (next) { next.revision = (oldScope.revision ?? 0) + 1; this.db.query('INSERT OR REPLACE INTO observation_scopes VALUES (?,?)').run(a.conversationId, JSON.stringify(next)); }
      if (!m.enabled) this.withdraw();
      else if (next && (next.excluded || next.private)) this.withdraw(a.conversationId);
      // Explicit reauthorization permits fresh owner state, never old message/operation copies.
      // saved() still requires a newly admitted message before publishing execution state.
      if (m.enabled) for (const row of this.db.query("SELECT id FROM observation_withdrawals WHERE kind='execution'").all() as { id: string }[]) {
        if (this.allowed(row.id) && this.db.query('SELECT id FROM conversations WHERE id=?').get(row.id)) this.db.query("DELETE FROM observation_withdrawals WHERE kind='execution' AND id=?").run(row.id);
      }
      this.append(a.conversationId ?? null, { object: { kind: 'conversation', id: a.conversationId ?? '*', revision: m.revision }, kind: 'scope-change', actor: 'application', origin: { rootId: a.conversationId ?? '*' }, occurredAt: stamp() });
      return { ...m, ...(next ? { conversation: next } : {}) };
    }).immediate();
  }
  /** Call after the main record write in the SAME transaction. Comparing before/after
   * admits new persisted facts only; enabling never enumerates historical messages. */
  saved(before: any, after: any) {
    if (!this.allowed(after.id)) return;
    const meta = this.meta(), priorMessages = new Map((before?.messages ?? []).map((m: any) => [m.id, m]));
    for (const m of after.messages) {
      if (!m.id || !['user', 'assistant'].includes(m.role)) continue;
      const ref = { kind: 'message', id: objectId(after.id, m.id) };
      const exists = this.db.query('SELECT id FROM observation_objects WHERE kind=? AND id=?').get(ref.kind, ref.id);
      if (priorMessages.has(m.id) && !exists) continue;
      // A pre-enable Run finishing later is historical, unless its submitted user fact was admitted.
      if (m.role === 'assistant' && m.run?.key && !this.db.query('SELECT id FROM observation_objects WHERE kind=? AND id=?').get('message', objectId(after.id, m.run.key))) continue;
      const text = m.role === 'user' ? String(m.text ?? '') : (m.run?.transcript ?? []).filter((t: any) => t.kind === 'text').map((t: any) => t.text).join('\n') || String(m.text ?? '');
      this.put(after.id, ref, { kind: m.role === 'user' ? 'message' : 'result', occurredAt: m.at ?? stamp(), actor: m.role, origin: { rootId: after.id, ...(m.runId || m.run?.runId ? { runId: m.runId ?? m.run.runId } : {}), ...(m.role === 'assistant' && m.run?.key ? { parentId: objectId(after.id, m.run.key) } : {}) }, content: { text, artifactRefs: (m.attachments ?? []).map((a: any) => `chat-attachment:${objectId(after.id, a.id)}`), truncated: false } });
    }
    for (const op of after.operations ?? []) {
      // Only observable outcomes; args, error strings, raw tool results and native data stay private.
      if (!op.key || op.sourceAdmission !== this.admission(after.id) || !op.createdAt || (!op.errors?.length && !['succeeded', 'rejected', 'failed', 'unknown'].includes(op.status))) continue;
      const prior = before?.operations?.find((p: any) => p.key === op.key);
      const ref = { kind: 'operation', id: objectId(after.id, op.key) };
      if (prior && !this.db.query('SELECT id FROM observation_objects WHERE kind=? AND id=?').get(ref.kind, ref.id) && prior.createdAt < meta.enabledAt) continue;
      this.put(after.id, ref, { kind: 'operation', occurredAt: op.errors?.at(-1)?.at ?? op.createdAt, actor: 'application', origin: { rootId: after.id, ...(op.output?.runId || op.args?.runId ? { runId: op.output?.runId ?? op.args.runId } : {}) }, content: { text: JSON.stringify({ operation: ['send','message','answer','stop'].includes(op.kind) ? op.kind : 'operation', status: op.status, error: !!op.errors?.length, errorCode: ['invalid','forbidden','conflict','not_found','unavailable','failed','transport','unknown'].includes(op.errorCode) ? op.errorCode : op.errors?.length ? 'failed' : null }), truncated: false } });
    }
    // Foreground responsibility is an owner fact, not a claim parsed from model text.
    // Only conversations with a submitted, observable message participate.
    if (this.db.query("SELECT id FROM observation_objects WHERE conversation_id=? AND kind='message' LIMIT 1").get(after.id)) {
      const pending = (after.operations ?? []).some((op: any) => !['succeeded','rejected','failed'].includes(op.status));
      const text = JSON.stringify({foregroundActive:!!after.active,pendingCommand:pending,terminalConfirmed:!after.active&&!pending});
      const oldExecution = this.db.query("SELECT value FROM observation_objects WHERE kind='execution' AND id=?").get(after.id) as {value:string}|null;
      if (!oldExecution || JSON.parse(oldExecution.value).content?.text !== text) this.put(after.id, {kind:'execution',id:after.id}, {kind:'operation',occurredAt:stamp(),actor:'application',origin:{rootId:after.id},content:{text,truncated:false}});
    }
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const last: any = this.db.query('SELECT MAX(seq) AS seq FROM observation_events WHERE at<?').get(cutoff);
    if (last?.seq) { this.db.query('DELETE FROM observation_events WHERE seq<=?').run(last.seq); meta.floor = Math.max(meta.floor, last.seq); this.setMeta(meta); }
  }
  deleted(id: string) {
    const m = this.meta(); m.revision++; this.setMeta(m); this.withdraw(id);
    this.append(id, { object: { kind: 'conversation', id, revision: m.revision }, kind: 'retract', occurredAt: stamp(), actor: 'application', origin: { rootId: id } });
  }
  evidence(conversationId: string, messageId: string) {
    if (!this.allowed(conversationId)) return null;
    const ref = { kind: 'message', id: objectId(conversationId, messageId) };
    const row: any = this.db.query('SELECT value FROM observation_objects WHERE kind=? AND id=?').get(ref.kind, ref.id);
    if (!row) return null;
    const event = JSON.parse(row.value);
    if (event.actor !== 'user') return null;
    return { source: this.source(), objectRef: event.object, actor: 'user', scopeRevision: this.meta().revision };
  }
  observations(a: any = {}) {
    const { limit, maxBytes } = bounds(a), meta = this.meta(), high = this.high(), after = position(a.after);
    const gap = a.sourceEpoch && a.sourceEpoch !== meta.epoch ? 'epoch_changed' : after > 0 && !a.sourceEpoch ? 'source_epoch_required' : after > high ? 'cursor_ahead' : after < meta.floor ? 'retention_gap' : undefined;
    const response: any = { source: this.source(), events: [], nextCursor: String(gap ? meta.floor : after), hasMore: false, coverage: { oldestAvailableCursor: String(meta.floor), complete: !gap, ...(gap ? { gap } : {}) }, capturedAt: stamp(), scopeRevision: meta.revision };
    if (gap) return this.fit(response, maxBytes);
    const rows = this.db.query('SELECT value FROM observation_events WHERE seq>? ORDER BY seq LIMIT ?').all(after, limit + 1) as any[];
    for (const row of rows.slice(0, limit)) {
      const event = JSON.parse(row.value);
      const candidate = { ...response, events: [...response.events, event], nextCursor: event.cursor, hasMore: Number(event.cursor) < high };
      if (bytes(candidate) <= maxBytes) { Object.assign(response, candidate); continue; }
      if (response.events.length) { response.hasMore = true; break; }
      // Advance even for oversized text; the versioned object ref supports bounded supplement reads.
      if (event.content) {
        const text = event.content.text ?? ''; event.content = { text: '', truncated: true };
        let lo = 0, hi = Buffer.byteLength(text);
        while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); event.content.text = utf8Prefix(text, mid); if (bytes(candidate) <= maxBytes) lo = mid; else hi = mid - 1; }
        event.content.text = utf8Prefix(text, lo);
      }
      Object.assign(response, candidate); this.fit(response, maxBytes); break;
    }
    return this.fit(response, maxBytes);
  }
  private fit(value: any, maxBytes: number) { if (bytes(value) > maxBytes) fail('byte_budget_too_small', 'maxBytes cannot fit response metadata'); return value; }
  private view(token: string) {
    const view = this.views.get(token), meta = this.meta();
    if (!view || view.expires <= Date.now()) { this.views.delete(token); return fail('snapshot_expired'); }
    if (view.epoch !== meta.epoch) fail('epoch_changed');
    if (view.scopeRevision !== meta.revision) fail('scope_changed');
    return view;
  }
  inventory(a: any = {}) {
    const { limit, maxBytes } = bounds(a), meta = this.meta();
    let token = a.snapshotToken;
    if (!token) {
      if (a.cursor) fail('invalid', 'snapshotToken required for continuation');
      for (const [key, view] of this.views) if (view.expires <= Date.now()) this.views.delete(key);
      const objects = this.objects().map(o => this.publicObject(o));
      // Keep memory predictable; fail explicitly instead of claiming a partial rebuild is complete.
      if (bytes(objects) > 16 * 1024 * 1024 || this.views.size >= 8) fail('snapshot_capacity', 'retry after existing snapshot expires');
      token = randomUUID(); this.views.set(token, { epoch: meta.epoch, scopeRevision: meta.revision, highWaterCursor: String(this.high()), expires: Date.now() + 300000, objects });
    }
    const view = this.view(token), start = position(a.cursor);
    if (start > view.objects.length) fail('invalid');
    const response: any = { source: this.source(), objects: [], snapshotToken: token, epoch: view.epoch, scopeRevision: view.scopeRevision, highWaterCursor: view.highWaterCursor, nextCursor: String(start), hasMore: start < view.objects.length, coverage: { complete: true } };
    for (let index = start; index < Math.min(view.objects.length, start + limit); index++) {
      const candidate = { ...response, objects: [...response.objects, view.objects[index].object], nextCursor: String(index + 1), hasMore: index + 1 < view.objects.length };
      if (bytes(candidate) > maxBytes) { if (!response.objects.length) fail('byte_budget_too_small'); break; }
      Object.assign(response, candidate);
    }
    return this.fit(response, maxBytes);
  }
  snapshot(a: any) {
    const { limit, maxBytes } = bounds(a), meta = this.meta(), ref = a.objectRef as Ref;
    if (!ref || !['message','operation','conversation','execution'].includes(ref.kind) || typeof ref.id !== 'string') fail('invalid', 'objectRef required');
    const view = a.snapshotToken ? this.view(a.snapshotToken) : null;
    let objects = (view?.objects ?? this.objects().map(o => this.publicObject(o))).filter(o => ref.kind === 'conversation' ? o.origin.rootId === ref.id : o.object.kind === ref.kind && o.object.id === ref.id);
    const retracted = ref.kind === 'conversation' ? !this.allowed(ref.id) || !this.db.query('SELECT id FROM conversations WHERE id=?').get(ref.id) : !!this.db.query('SELECT id FROM observation_withdrawals WHERE kind=? AND id=?').get(ref.kind, ref.id);
    if (retracted) objects = [];
    const currentRevision = objects.length === 1 ? objects[0].object.revision : null;
    if (!retracted && a.expectedRevision !== undefined && currentRevision !== a.expectedRevision) fail('revision_changed');
    let index = 0, offset = 0;
    if (a.cursor) {
      let cursor: any;
      try { cursor = JSON.parse(Buffer.from(a.cursor, 'base64url').toString()); } catch { fail('invalid', 'invalid snapshot cursor'); }
      if (cursor.ref !== JSON.stringify(ref) || cursor.token !== (a.snapshotToken ?? '') || cursor.versions !== JSON.stringify(objects.map(o => o.object.revision))) fail('revision_changed');
      index = position(cursor.index); offset = position(cursor.offset);
    }
    if (index > objects.length) fail('invalid');
    const response: any = { source: this.source(), objectRef: ref, currentRevision, retracted, items: [], nextCursor: '', hasMore: false, coverage: { complete: retracted || objects.length > 0 }, scopeRevision: meta.revision };
    const cursorFor = (i: number, n: number) => Buffer.from(JSON.stringify({ ref: JSON.stringify(ref), token: a.snapshotToken ?? '', versions: JSON.stringify(objects.map(o => o.object.revision)), index: String(i), offset: String(n) })).toString('base64url');
    while (index < objects.length && response.items.length < limit) {
      const original = objects[index], fullText = original.content?.text ?? '', buf = Buffer.from(fullText);
      if (offset > buf.length || (offset < buf.length && (buf[offset]! & 0xc0) === 0x80)) fail('invalid', 'cursor is not a UTF-8 boundary');
      const remaining = buf.subarray(offset).toString('utf8');
      const event = structuredClone(original);
      if (event.content) event.content = { ...event.content, text: remaining, offsetBytes: offset, truncated: offset > 0 };
      const nextIndex = index + 1;
      let candidate = { ...response, items: [...response.items, event], nextCursor: nextIndex < objects.length ? cursorFor(nextIndex, 0) : '', hasMore: nextIndex < objects.length };
      if (bytes(candidate) <= maxBytes) { Object.assign(response, candidate); index++; offset = 0; continue; }
      if (response.items.length) break;
      if (!event.content) fail('byte_budget_too_small');
      // Reserve the continuation metadata before measuring bytes, including non-ASCII text.
      event.content.artifactRefs = []; event.content.truncated = true;
      let lo = 0, hi = Buffer.byteLength(remaining);
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2), text = utf8Prefix(remaining, mid), nextOffset = offset + Buffer.byteLength(text);
        event.content.text = text; candidate = { ...response, items: [event], nextCursor: cursorFor(index, nextOffset), hasMore: true };
        if (bytes(candidate) <= maxBytes) lo = mid; else hi = mid - 1;
      }
      const text = utf8Prefix(remaining, lo), consumed = Buffer.byteLength(text);
      if (!consumed) fail('byte_budget_too_small');
      event.content.text = text; response.items = [event]; response.nextCursor = cursorFor(index, offset + consumed); response.hasMore = true;
      return this.fit(response, maxBytes);
    }
    return this.fit(response, maxBytes);
  }
}
