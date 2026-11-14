import { Database } from 'bun:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, coreDigest } from './core-store';
import { redactSensitiveText, REDACTED } from './core-redaction';
import { scopeCovers, type CoreMindService } from './core-service';
import type { CoreCall } from './core-execution';
import type { CoreAccess, CoreState, GuardActionInput, Scope } from './core-types';

const MAX_RESULT_BYTES = 32 * 1024;
const MAX_PARAMS_BYTES = 8 * 1024;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const credentialKey = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?(?:secret|token|key)|token|password|passphrase|secret|authorization|cookie|set-cookie|private[_-]?key)$/i;
function clean(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value, Number.MAX_SAFE_INTEGER);
  if (Array.isArray(value)) return value.map(clean);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [redactSensitiveText(k, Number.MAX_SAFE_INTEGER), credentialKey.test(k) ? REDACTED : clean(v)]));
  return value;
}
function text(v: unknown, label: string, max = 256): asserts v is string {
  if (typeof v !== 'string' || !v.trim() || Buffer.byteLength(v) > max) throw Error(`Invalid ${label}`);
}
function owner(access: CoreAccess) {
  if (access?.role !== 'owner' || !access.subject) throw Error('Trusted owner configuration is required; autonomous agents cannot grant adapters');
}

/** Exact params are the bounded parameter policy, not a caller supplied schema or effect claim. */
export interface ApplicationGrantInput {
  moduleId: string; activeHash: string; tool: string; effect: 'read';
  params: Record<string, unknown>; description: string;
}
export interface ApplicationAdapter extends ApplicationGrantInput {
  id: string; source: 'owner' | 'builtin'; grantedBy: string; grantedAt: string; revokedAt?: string;
}
export interface ApplicationInvokeInput {
  actionKey: string; pursuitId: string; expectedRevision: number; expectedVisibilityRevision: number;
  adapterId: string; params: Record<string, unknown>;
}
export interface ApplicationReceipt {
  ref: string; actionKey: string; intentDigest: string; adapterId: string;
  moduleId: string; activeHash: string; tool: string; effect: 'read'; argsDigest: string;
  pursuitId: string; pursuitRevision: number; visibilityRevision: number;
  actor: string; runRef: string; createdAt: string; completedAt?: string;
  status: 'unknown' | 'succeeded' | 'failed' | 'withheld';
  /** Digest of the complete sanitized responseBody; never a digest asserted by a model. */
  responseDigest?: string; responseBody?: unknown;
  reason?: 'dispatch-exception' | 'unknown-reply' | 'application-error' | 'invalid-result' | 'result-too-large' | 'authorization-changed';
  /** Content was withdrawn; status still describes only the outcome actually observed before cleanup. */
  contentWithdrawn?: true;
}
interface StoredInvocation {
  receipt: ApplicationReceipt; guard?: GuardActionInput; access?: CoreAccess;
  /** IDs and scope only, so later edits cannot detach the original read-permission dependencies. */
  basis?: { scope: Scope; evidenceRefs: string[]; understandingRefs: string[] };
}
export interface ApplicationCleanupResult {
  scrubbed: number;
  /** Scrubbed unknown outcomes still require reconciliation; cleanup does not confirm external completion. */
  deferred: number;
  checkpoint: 'complete' | 'busy';
}
interface DirectoryRow { id: string; name: string; activeHash: string }

/** Mind-private registry and original read receipts. CoreCall and CoreAccess must come from main, never tool JSON. */
export class CoreApplication {
  private readonly db: Database;
  private readonly inFlight = new Set<string>();
  constructor(directory: string, private readonly service: CoreMindService, private readonly call: CoreCall,
    private readonly selfModuleId: string) {
    text(selfModuleId, 'Mind module ID');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'mind-application.sqlite');
    this.db = new Database(path, { create: true }); chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS adapters(id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invocations(ref TEXT PRIMARY KEY, action_key TEXT UNIQUE NOT NULL, json TEXT NOT NULL);`);
  }
  private async directory(): Promise<DirectoryRow[]> {
    const rows: DirectoryRow[] = [], seen = new Set<string>(); let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const result = await this.call('modules.list', { limit: 100, ...(cursor ? { cursor } : {}) });
      if (!isObject(result) || !Array.isArray(result.items) || result.items.length > 100 ||
        !(result.nextCursor == null || typeof result.nextCursor === 'string')) throw Error('Invalid module directory');
      for (const row of result.items) {
        if (!isObject(row) || typeof row.id !== 'string' || typeof row.name !== 'string') throw Error('Invalid module directory entry');
        if (typeof row.activeHash === 'string' && row.activeHash) rows.push({ id: row.id, name: row.name, activeHash: row.activeHash });
      }
      if (!result.nextCursor) {
        if (new Set(rows.map(r => r.id)).size !== rows.length) throw Error('Ambiguous module directory');
        return rows;
      }
      if (seen.has(result.nextCursor)) throw Error('Repeated module directory cursor');
      seen.add(result.nextCursor); cursor = result.nextCursor;
    }
    throw Error('Module directory exceeds bounded inventory');
  }
  private safeTarget(row: DirectoryRow, tool: string) {
    // Directory identities, not display text/tool descriptions, exclude self and privileged surfaces.
    if (row.id === this.selfModuleId || /^(mind|author|approvals?|secrets?|kernel|system|agent|modules)$/i.test(row.name) ||
      /(?:^|[._:/-])(submit|approvals?|secrets?|kernel|payment|pay|send|delete|publish)(?:$|[._:/-])/i.test(tool)) {
      throw Error('Administrative or unsupported application target');
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(tool)) throw Error('Invalid application tool');
  }
  private validate(input: ApplicationGrantInput) {
    text(input.moduleId, 'module ID'); text(input.activeHash, 'active hash'); text(input.tool, 'tool');
    text(input.description, 'reviewed description', 1024);
    if (input.effect !== 'read') throw Error('Only reviewed read effects are supported');
    if (!isObject(input.params)) throw Error('Expected exact bounded params');
    const params = canonical(input.params);
    if (Buffer.byteLength(params) > MAX_PARAMS_BYTES) throw Error('Params exceed 8 KiB');
    if (canonical(clean(input.params)) !== params || redactSensitiveText(input.description, Number.MAX_SAFE_INTEGER) !== input.description) throw Error('Credentials cannot be stored in adapter configuration');
  }
  private adapters(): ApplicationAdapter[] {
    return (this.db.query('SELECT json FROM adapters ORDER BY id').all() as { json: string }[]).map(r => JSON.parse(r.json));
  }
  private builtin(rows: DirectoryRow[]): ApplicationAdapter | undefined {
    const matches = rows.filter(r => r.name === 'pi');
    if (matches.length > 1) throw Error('Ambiguous Pi application');
    const pi = matches[0]; if (!pi) return undefined;
    this.safeTarget(pi, 'models');
    // Explicit reviewed adapter: pi.models discovers model options without calling a model. No other pi tools.
    return { id: `builtin:pi.models:${coreDigest([pi.id, pi.activeHash])}`, moduleId: pi.id, activeHash: pi.activeHash,
      tool: 'models', effect: 'read', params: {}, description: 'Discover locally configured Pi model options without model invocation',
      source: 'builtin', grantedBy: 'mind:reviewed-pi-models', grantedAt: 'builtin' };
  }
  async list(access: CoreAccess): Promise<ApplicationAdapter[]> {
    if (!access?.subject || !['owner', 'runtime', 'application'].includes(access.role)) throw Error('Trusted access required');
    const rows = await this.directory(), builtin = this.builtin(rows);
    return [...(builtin ? [builtin] : []), ...this.adapters().filter(a => !a.revokedAt && rows.some(r => r.id === a.moduleId && r.activeHash === a.activeHash))];
  }
  /** Main exposes this only on its authenticated owner configuration path, after source review. */
  async grant(input: ApplicationGrantInput, access: CoreAccess): Promise<ApplicationAdapter> {
    owner(access);
    input = structuredClone({ moduleId: input.moduleId, activeHash: input.activeHash, tool: input.tool,
      effect: input.effect, params: input.params, description: input.description });
    this.validate(input);
    const row = (await this.directory()).find(r => r.id === input.moduleId);
    if (!row || row.activeHash !== input.activeHash) throw Error('Exact active application version is required');
    this.safeTarget(row, input.tool);
    return this.db.transaction(() => {
      const id = `owner:${coreDigest({ moduleId: input.moduleId, activeHash: input.activeHash, tool: input.tool,
        effect: input.effect, params: input.params, description: input.description })}`;
      const matching = this.adapters().filter(a => a.id === id || a.id.startsWith(`${id}:`));
      const active = matching.find(a => !a.revokedAt);
      if (active) return active;
      // Reauthorization gets a distinct ID; old invocations cannot silently inherit a new grant.
      const adapter: ApplicationAdapter = { ...input, id: matching.length ? `${id}:${crypto.randomUUID()}` : id,
        source: 'owner', grantedBy: access.subject, grantedAt: new Date().toISOString() };
      this.db.query('INSERT INTO adapters(id,json) VALUES(?,?)').run(adapter.id, JSON.stringify(adapter));
      return adapter;
    }).immediate();
  }
  revoke(id: string, access: CoreAccess): ApplicationAdapter {
    owner(access); text(id, 'adapter ID', 512);
    const adapter = this.adapters().find(a => a.id === id); if (!adapter) throw Error('Owner adapter not found');
    if (!adapter.revokedAt) { adapter.revokedAt = new Date().toISOString(); this.db.query('UPDATE adapters SET json=? WHERE id=?').run(JSON.stringify(adapter), id); }
    return adapter;
  }
  private async resolve(id: string): Promise<ApplicationAdapter> {
    const rows = await this.directory(), builtin = this.builtin(rows);
    const adapter = builtin?.id === id ? builtin : this.adapters().find(a => a.id === id && !a.revokedAt);
    if (!adapter) throw Error('Adapter authorization missing or revoked');
    const row = rows.find(r => r.id === adapter.moduleId);
    if (!row || row.activeHash !== adapter.activeHash) throw Error('Application active version changed');
    this.validate(adapter); this.safeTarget(row, adapter.tool); return adapter;
  }
  private stored(ref: string): StoredInvocation {
    const row = this.db.query('SELECT json FROM invocations WHERE ref=?').get(ref) as { json: string } | null;
    if (!row) throw Error('Application receipt not found'); return JSON.parse(row.json);
  }
  private save(stored: StoredInvocation) {
    // SQLite CAS preserves the first terminal result even across two adapter instances.
    this.db.query(`INSERT INTO invocations(ref,action_key,json) VALUES(?,?,?) ON CONFLICT(ref) DO UPDATE SET json=excluded.json
      WHERE json_extract(invocations.json,'$.receipt.status')='unknown'
        AND json_extract(invocations.json,'$.receipt.contentWithdrawn') IS NULL`)
      .run(stored.receipt.ref, stored.receipt.actionKey, JSON.stringify(stored));
    const latest = this.stored(stored.receipt.ref);
    delete stored.guard; delete stored.access; delete stored.basis;
    Object.assign(stored, latest);
  }
  private basis(pursuitId: string, state: CoreState): NonNullable<StoredInvocation['basis']> {
    const p = state.pursuits.find(p => p.id === pursuitId);
    if (!p) throw Error('Application pursuit not found');
    const understandings = state.understandings.filter(u => p.understandingRefs.includes(u.id));
    return { scope: p.scope, understandingRefs: [...p.understandingRefs],
      evidenceRefs: [...new Set([...p.evidenceRefs, ...understandings.flatMap(u => [...u.supportingRefs, ...u.opposingRefs])])] };
  }
  private withdrawn(stored: StoredInvocation, state: CoreState): boolean {
    const r = stored.receipt, p = state.pursuits.find(p => p.id === r.pursuitId);
    if (r.contentWithdrawn || state.settings.restoreBlocked || state.visibilityRevision !== r.visibilityRevision || !p || !p.goal) return true;
    const basis = stored.basis ?? this.basis(p.id, state);
    const evidenceRefs = new Set([...basis.evidenceRefs, ...p.evidenceRefs]);
    for (const id of new Set([...basis.understandingRefs, ...p.understandingRefs])) {
      const u = state.understandings.find(u => u.id === id);
      if (!u || u.status === 'retracted' || !u.value) return true;
      for (const ref of [...u.supportingRefs, ...u.opposingRefs]) evidenceRefs.add(ref);
    }
    return [...evidenceRefs].some(id => {
      const e = state.evidence.find(e => e.id === id); return !e || !!e.retractedAt || !!e.expiredAt;
    });
  }
  private visible(stored: StoredInvocation, access: CoreAccess) {
    const r = stored.receipt;
    const p = this.service.detail({ kind: 'pursuit', id: r.pursuitId }, access);
    const state = this.service.store.read();
    if (this.withdrawn(stored, state)) throw Error('Receipt visibility withdrawn');
    const basis = stored.basis ?? this.basis(p.id, state);
    if (!access.scopes.some(scope => scopeCovers(scope, basis.scope))) throw Error('Caller scope does not cover original receipt');
    // Read permission uses the caller's current scope and live evidence, not the original actor's responsibility.
    const evidenceRefs = new Set([...basis.evidenceRefs, ...p.evidenceRefs]);
    for (const id of new Set([...basis.understandingRefs, ...p.understandingRefs])) {
      const u = this.service.detail({ kind: 'understanding', id }, access);
      for (const ref of [...u.supportingRefs, ...u.opposingRefs]) evidenceRefs.add(ref);
    }
    for (const id of evidenceRefs) {
      const e = this.service.detail({ kind: 'evidence', id }, access);
      if (e.retractedAt || e.expiredAt || (e.sourceIdentity !== 'owner' && e.sourceIdentity !== 'mind-owner' &&
        !state.checkpoints.some(cp => cp.sourceIdentity === e.sourceIdentity && cp.epoch === e.epoch &&
          cp.scopeRevision === e.scopeRevision && cp.coverage.complete))) throw Error('Receipt evidence is no longer readable');
    }
  }
  readReceipt(ref: string, access: CoreAccess): ApplicationReceipt {
    const stored = this.stored(ref), receipt = stored.receipt; this.visible(stored, access);
    if (receipt.responseDigest && coreDigest(receipt.responseBody) !== receipt.responseDigest) throw Error('Application response digest mismatch');
    return receipt;
  }
  /** Logical deletion from this private journal only; does not erase backups, other apps, or in-flight memory. */
  cleanupWithdrawn(): ApplicationCleanupResult {
    const result = this.db.transaction(() => {
      const state = this.service.store.read(); let scrubbed = 0, deferred = 0;
      const rows = this.db.query('SELECT ref,json FROM invocations').all() as { ref: string; json: string }[];
      for (const row of rows) {
        const stored = JSON.parse(row.json) as StoredInvocation;
        if (!this.withdrawn(stored, state)) continue;
        if (stored.receipt.status === 'unknown') deferred++;
        if (stored.receipt.contentWithdrawn) continue;
        delete stored.receipt.responseBody; delete stored.receipt.responseDigest;
        stored.receipt.contentWithdrawn = true;
        delete stored.guard; delete stored.access;
        // Exact original identities/digests and outcome remain; no command payload is needed for a forbidden retry.
        scrubbed += this.db.query('UPDATE invocations SET json=? WHERE ref=? AND json=?')
          .run(JSON.stringify(stored), row.ref, row.json).changes;
      }
      return { scrubbed, deferred };
    }).immediate();
    // Outside the write transaction. SQLite reports pinned readers; never delete/truncate WAL files manually.
    const checkpoint = this.db.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number };
    return { ...result, checkpoint: checkpoint.busy ? 'busy' : 'complete' };
  }
  private record(stored: StoredInvocation) {
    if (stored.receipt.contentWithdrawn || !stored.access) return;
    const r = stored.receipt;
    this.service.recordAction({ actionKey: `${r.actionKey}:application-outcome:${r.status}`,
      expectedVisibilityRevision: this.service.store.read().visibilityRevision, effectActionKey: r.actionKey,
      outcome: r.status === 'succeeded' ? 'succeeded' : r.status === 'unknown' ? 'unknown' : 'failed', originalReceiptRef: r.ref },
    { subject: 'mind:application-adapter', role: 'runtime', scopes: stored.access.scopes });
  }
  async invoke(input: ApplicationInvokeInput, access: CoreAccess): Promise<ApplicationReceipt> {
    // Freeze caller objects before any await: retries must preserve the exact original command.
    input = structuredClone(input); access = structuredClone(access);
    text(input.actionKey, 'action key', 400); text(input.adapterId, 'adapter ID', 512);
    if (this.inFlight.has(input.actionKey)) throw Error('Application read already in flight; query its receipt');
    this.inFlight.add(input.actionKey);
    try {
      const adapter = await this.resolve(input.adapterId);
      if (canonical(input.params) !== canonical(adapter.params)) throw Error('Params differ from exact owner authorization');
      const guard: GuardActionInput = { actionKey: input.actionKey, pursuitId: input.pursuitId,
        expectedRevision: input.expectedRevision, expectedVisibilityRevision: input.expectedVisibilityRevision,
        target: 'application-read', arguments: { adapterId: adapter.id, moduleId: adapter.moduleId, activeHash: adapter.activeHash,
          tool: adapter.tool, effect: 'read', params: adapter.params } };
      this.service.guardAction(guard, access);
      const ref = `mind-application:${coreDigest(input.actionKey)}`;
      const intentDigest = coreDigest({ guard, subject: access.subject, role: access.role, execution: access.execution });
      const stored = this.db.transaction(() => {
        const prior = this.db.query('SELECT json FROM invocations WHERE ref=?').get(ref) as { json: string } | null;
        if (prior) {
          const original = JSON.parse(prior.json) as StoredInvocation;
          if (original.receipt.intentDigest !== intentDigest) throw Error('Action key cannot change original application command');
          return original;
        }
        const receipt: ApplicationReceipt = { ref, actionKey: input.actionKey, intentDigest, adapterId: adapter.id,
          moduleId: adapter.moduleId, activeHash: adapter.activeHash, tool: adapter.tool, effect: 'read', argsDigest: coreDigest(adapter.params),
          pursuitId: input.pursuitId, pursuitRevision: input.expectedRevision, visibilityRevision: input.expectedVisibilityRevision,
          actor: access.execution!.actor, runRef: access.execution!.runRef, createdAt: new Date().toISOString(), status: 'unknown' };
        const prepared: StoredInvocation = { receipt, guard, access, basis: this.basis(input.pursuitId, this.service.store.read()) };
        this.save(prepared); return prepared;
      }).immediate();
      if (stored.receipt.contentWithdrawn || !stored.guard || !stored.access) throw Error('Receipt visibility withdrawn; original outcome may still be unknown');
      if (stored.receipt.status !== 'unknown') { this.visible(stored, access); this.record(stored); return stored.receipt; }
      // An unknown read can repeat only this persisted, original command/key. No writes reach this adapter.
      this.record(stored);
      let raw: unknown;
      try { raw = await this.call({ moduleId: stored.receipt.moduleId, tool: stored.receipt.tool },
        structuredClone(adapter.params), { key: `mind-application:${coreDigest(input.actionKey)}`,
          expectedTarget: { moduleId: stored.receipt.moduleId, hash: stored.receipt.activeHash } }); }
      catch { // Exception text can contain credentials; persist only the observed failure category.
        console.error(JSON.stringify({ component: 'mind', event: 'application_dispatch_exception', reason: 'CoreCall rejected; receipt remains unknown' }));
        // A previous unknown observation is not the result of this failed attempt.
        delete stored.receipt.responseBody; delete stored.receipt.responseDigest;
        stored.receipt.reason = 'dispatch-exception'; this.save(stored); this.record(stored); return this.readReceipt(ref, access);
      }
      // Every await that can change authority is followed by directory, registry, then synchronous core guard checks.
      try { await this.resolve(adapter.id); this.service.guardAction(stored.guard, access); }
      catch {
        console.error(JSON.stringify({ component: 'mind', event: 'application_response_withheld', reason: 'Adapter/version/core authorization revalidation failed' }));
        stored.receipt.status = 'withheld'; stored.receipt.reason = 'authorization-changed';
        stored.receipt.completedAt = new Date().toISOString(); this.save(stored); this.record(stored);
        throw Error(`Application response withheld after authorization changed; receipt ${ref}`);
      }
      const r = stored.receipt;
      // Each observation belongs to this actual reply; a retry must not reuse an older unknown body.
      delete r.responseBody; delete r.responseDigest; delete r.reason;
      if (raw === undefined) {
        r.reason = 'unknown-reply'; this.save(stored); return this.readReceipt(ref, access);
      }
      let body: unknown;
      try {
        if (Buffer.byteLength(canonical(raw)) > MAX_RESULT_BYTES) throw Error('result-too-large');
        body = clean(raw);
        if (Buffer.byteLength(canonical(body)) > MAX_RESULT_BYTES) throw Error('result-too-large');
      } catch (error) {
        r.status = 'failed'; r.reason = error instanceof Error && error.message === 'result-too-large' ? 'result-too-large' : 'invalid-result';
        console.error(JSON.stringify({ component: 'mind', event: 'application_result_rejected', reason: r.reason }));
        r.completedAt = new Date().toISOString(); this.save(stored); this.record(stored); return this.readReceipt(ref, access);
      }
      if (isObject(raw) && (raw.status === 'unknown' || raw.outputState === 'unknown' || raw.approvalRequired === true || raw.status === 'pending')) {
        r.reason = 'unknown-reply'; r.responseBody = body; r.responseDigest = coreDigest(body);
        this.save(stored); return this.readReceipt(ref, access);
      }
      r.status = isObject(raw) && (raw.ok === false || raw.success === false || raw.isError === true || raw.status === 'failed' || raw.error != null) ? 'failed' : 'succeeded';
      if (r.status === 'failed') r.reason = 'application-error'; else delete r.reason;
      r.responseBody = body; r.responseDigest = coreDigest(body); r.completedAt = new Date().toISOString();
      this.save(stored); this.record(stored); return this.readReceipt(ref, access);
    } finally { this.inFlight.delete(input.actionKey); }
  }
  close() { this.db.close(); }
}
