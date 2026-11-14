import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store as ChatStore } from '../chat/state';
import { objectId } from '../chat/observations';
import { CoreMindStore } from './core-store';
import { CoreMindService } from './core-service';
import { CoreSources } from './core-sources';
import { CoreActions } from './core-actions';
import { CoreRuntime } from './core-runtime';
import type { CoreCall, Target, ToolFact } from './core-execution';
import type { CoreAccess, PursueInput } from './core-types';

const mindIdentity = { moduleId: 'joined-mind', hash: 'approved-mind-v1' };
const chatIdentity = { moduleId: 'joined-chat', hash: 'approved-chat-v1' };
const providerIdentity = { moduleId: 'offline-provider', hash: 'approved-provider-v1' };
const owner: CoreAccess = { subject: 'authenticated-owner', role: 'owner', scopes: [{}] };
const text = 'Continue preparing a train itinerary arriving before noon; use the supplied 09:00 departure and 11:30 arrival.';
const provider = { id: 'offline', ...providerIdentity, revision: 1, available: true,
  capabilities: { conversation: true, images: false } };
type Principal = typeof mindIdentity;
type Run = { runId: string; contextId: string; status: string; active: boolean; ended: boolean;
  principal: Principal; args: Record<string, unknown>; items: unknown[] };
function gate() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, async pause() { enter(); await released; } };
}

/** Only the kernel transport/provider is fake. Caller and current Run metadata are
 * fixed by this gateway, never accepted from a tool's arguments. No model runs. */
class Harness {
  now = new Date().toISOString();
  readonly directory = mkdtempSync(join(tmpdir(), 'mind-chat-responsibility-'));
  readonly runs: Run[] = [];
  readonly commands = new Map<string, Run>();
  readonly calls: { principal: Principal; target: Target; args: Record<string, unknown> }[] = [];
  readonly sourceReads: string[] = [];
  readonly providerInvocations: { runId: string; outcome: string }[] = [];
  readonly failProviderStep = new Set<string>();
  readonly store = new CoreMindStore(join(this.directory, 'mind'));
  readonly service = new CoreMindService(this.store, { now: () => this.now });
  readonly actions = new CoreActions(join(this.directory, 'mind'), this.service);
  readonly runtime = new CoreRuntime(this.store, this.service, this.transport(mindIdentity), () => mindIdentity,
    this.actions, () => this.now);
  readonly chat = new ChatStore(join(this.directory, 'chat'), join(this.directory, 'content'), this.transport(chatIdentity));
  readonly sources = new CoreSources(this.store, this.service, async (target, args) => {
    expect(target.moduleId).toBe(chatIdentity.moduleId); this.sourceReads.push(target.tool);
    switch (target.tool) {
      case 'observation-scope': return this.chat.observations.scopeTool(args);
      case 'observation-inventory': return this.chat.observations.inventory(args);
      case 'snapshot': return this.chat.observations.snapshot(args);
      case 'observations': return this.chat.observations.observations(args);
      default: throw Error(`Unexpected source tool ${target.tool}`);
    }
  }, () => chatIdentity);
  conversationId = '';
  sendGate?: ReturnType<typeof gate>;
  loseControlReply = false;
  stopConfirmed = false;
  constructor() {
    this.chat.moduleId = chatIdentity.moduleId; this.chat.version = chatIdentity.hash;
    this.chat.mindTarget = { moduleId: mindIdentity.moduleId, tool: 'context' };
    this.chat.observations.scopeTool({ expectedRevision: 0, enabled: true });
    this.conversationId = this.chat.create(provider.id).id;
    this.chat.draft(this.conversationId, { draft: text }, 0);
  }
  transport(principal: Principal): CoreCall {
    return async (target, args, options) => {
      this.calls.push({ principal, target, args: structuredClone(args) });
      if (this.calls.length > 500) throw Error('Bounded gateway call limit exceeded');
      if (target === 'modules.list') return { items: [{ id: mindIdentity.moduleId, name: 'mind', hash: mindIdentity.hash },
        { id: chatIdentity.moduleId, name: 'chat', hash: chatIdentity.hash },
        { id: providerIdentity.moduleId, name: 'offline-provider', hash: providerIdentity.hash }], nextCursor: null };
      if (target === 'modules.describe') return { items: [{ target: 'agent.providers', description: 'Current provider availability' }], nextCursor: null };
      if (target === 'agent.providers') return { items: [provider], nextCursor: null };
      if (typeof target !== 'string' && target.moduleId === mindIdentity.moduleId && target.tool === 'context') {
        expect(principal).toEqual(chatIdentity);
        return { json: JSON.stringify(this.service.context({ query: String(args.query), scope: { sessionId: String(args.scope) },
          limit: Number(args.limit) }, { subject: `module:${principal.moduleId}:${principal.hash}`, role: 'application', scopes: [{}] })) };
      }
      if (target === 'agent.run') {
        expect(options?.key).toBeTruthy();
        const key = `${principal.moduleId}:${options!.key!}`, prior = this.commands.get(key);
        if (prior) { expect(prior.args).toEqual(args); return prior; }
        if (principal.moduleId === chatIdentity.moduleId) await this.sendGate?.pause();
        if (principal.moduleId === mindIdentity.moduleId) {
          expect(args.lane).toBe('background');
          expect(this.runs.filter(r => r.principal.moduleId === mindIdentity.moduleId && r.active)).toHaveLength(0);
        }
        const n = this.runs.length + 1;
        const run: Run = { runId: `kernel-run-${n}`, contextId: `kernel-context-${n}`, status: 'running',
          active: true, ended: false, principal, args: structuredClone(args), items: [] };
        this.commands.set(key, run); this.runs.push(run);
        this.providerInvocations.push({ runId: run.runId, outcome: 'started' });
        return run;
      }
      if (target === 'agent.read' || target === 'agent.stop' || target === 'agent.write') {
        const run = this.runs.find(r => r.runId === args.runId);
        if (!run || run.principal.moduleId !== principal.moduleId || run.principal.hash !== principal.hash)
          throw Object.assign(Error('Run belongs to another authenticated application'), { code: 'forbidden' });
        if (target === 'agent.stop') return { ...run, stopConfirmed: this.stopConfirmed && !run.active };
        if (target === 'agent.write') {
          if (this.loseControlReply) throw Object.assign(Error('Original control reply lost'), { code: 'unknown' });
          return { runId: run.runId, accepted: true };
        }
        if (this.failProviderStep.has(run.runId) && run.active) {
          // A deterministic backend invocation actually rejects. The fake kernel
          // translates its confirmed failure into the public terminal Run view.
          try { await this.providerStep(run); }
          catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.providerInvocations.find(x => x.runId === run.runId)!.outcome = `failed: ${reason}`;
            Object.assign(run, { active: false, ended: true, status: 'failed' });
          }
        }
        return { run, items: run.items, ended: run.ended, nextCursor: null, interactions: [],
          transcript: run.ended ? [{ kind: 'text', text: 'The ongoing itinerary still needs preparation.', at: this.now }] : [] };
      }
      throw Error(`Unexpected kernel target ${JSON.stringify(target)}`);
    };
  }
  private async providerStep(run: Run) {
    expect(this.providerInvocations.some(x => x.runId === run.runId)).toBe(true);
    if (this.failProviderStep.has(run.runId)) throw Error('Temporary backend invocation failure');
  }
  get foreground() { return this.runs.find(r => r.principal.moduleId === chatIdentity.moduleId)!; }
  get background() { return this.runs.filter(r => r.principal.moduleId === mindIdentity.moduleId); }
  get pursuit() { return this.store.read().pursuits[0]!; }
  get evidence() { return this.store.read().evidence.find(e => e.actor === 'user' && !e.retractedAt &&
    e.object.id === objectId(this.conversationId, 'actual-send'))!; }
  async send() { return this.chat.operate(this.conversationId, 'actual-send', 'send', {}); }
  async sync() { expect((await this.sources.sync()).status).toBe('synced'); }
  goalInput(key: string): PursueInput {
    return { actionKey: key, expectedRevision: 0, expectedVisibilityRevision: this.store.read().visibilityRevision,
      semanticKey: 'ongoing-train-itinerary', goal: text, completionCriteria: ['Itinerary gives the supplied departure and arrival before noon'],
      scope: { sessionId: this.conversationId }, reason: 'explicit-goal', evidenceRefs: [this.evidence.id] };
  }
  goal(key = 'owner-explicit-goal') { return this.service.pursue(this.goalInput(key), owner).value!; }
  execution() {
    return this.store.read().evidence.find(e => e.object.kind === 'execution' && !e.retractedAt)!;
  }
  mutation(key: string) { return { actionKey: key, pursuitId: this.pursuit.id, expectedRevision: this.pursuit.revision,
    expectedVisibilityRevision: this.store.read().visibilityRevision }; }
  documentInput(key = 'one-itinerary') {
    return { ...this.mutation(key), target: 'document', arguments: {},
      document: { title: 'Train itinerary', body: 'Depart 09:00; arrive 11:30, before noon. Source: submitted timetable.' } };
  }
  /** This is trusted event.call.executionRunId, supplied by the gateway from the
   * actual selected Run, analogous to index.ts's accessForCaller adapter. */
  access(run: Run) {
    return this.runtime.accessForCaller(`module:${run.principal.moduleId}:${run.principal.hash}`,
      run.principal.moduleId === mindIdentity.moduleId && run.principal.hash === mindIdentity.hash, run.runId);
  }
  async tool(run: Run, target: Target, args: Record<string, unknown>) {
    expect(run.active).toBe(true);
    expect(run.args.tools as Target[]).toContainEqual(target);
    let output: unknown;
    if (typeof target === 'string') output = await this.transport(run.principal)(target, args);
    else if (target.moduleId === mindIdentity.moduleId && target.tool === 'action') {
      await this.runtime.bindResponsibility();
      output = this.actions.create(args as ReturnType<Harness['documentInput']>, this.access(run));
    } else throw Error(`Unimplemented selected tool ${JSON.stringify(target)}`);
    const identity = typeof target === 'string' ? { moduleId: `system:${target.split('.')[0]}`, hash: 'kernel-contract-v1' } : mindIdentity;
    const fact: ToolFact = { ...identity, runId: run.runId, callId: `called-${run.items.length + 1}`, target,
      status: 'succeeded', outputState: 'complete', output: { json: JSON.stringify(output) } };
    run.items.push({ kind: 'tool-result', payload: { type: 'tool-result', value: fact } });
    expect(run.items.length).toBeLessThanOrEqual(50);
    return output;
  }
  async terminal() {
    Object.assign(this.foreground, { active: false, ended: true, status: 'finished' });
    this.stopConfirmed = true; this.loseControlReply = false;
    await this.chat.reconcile(this.conversationId); await this.sync();
    expect(this.chat.get(this.conversationId).active).toBeNull();
    expect(JSON.parse(this.execution().content!.text!)).toEqual({ foregroundActive: false, pendingCommand: false, terminalConfirmed: true });
  }
  close() {
    this.runtime.close(); this.actions.close(); this.store.close(); this.chat.close();
    rmSync(this.directory, { recursive: true, force: true });
  }
}

describe('acceptance scenarios 12/22: actual Chat feed joined to Mind responsibility', () => {
  for (const boundary of ['pending-send', 'active', 'terminal-unconfirmed', 'stop-unconfirmed', 'pending-control'] as const) {
    test(`${boundary} prevents Mind work; owner-confirmed terminal permits exactly one bound actor and effect`, async () => {
      const f = new Harness(); let sending: Promise<unknown> | undefined;
      try {
        if (boundary === 'pending-send') {
          f.sendGate = gate(); sending = f.send(); await f.sendGate.entered;
        } else await f.send();
        if (boundary === 'terminal-unconfirmed') Object.assign(f.foreground, { active: false, status: 'finished', ended: false });
        if (boundary === 'stop-unconfirmed') {
          Object.assign(f.foreground, { active: false, status: 'finished', ended: true });
          await f.chat.operate(f.conversationId, 'original-stop', 'stop', {});
        }
        if (boundary === 'pending-control') {
          f.loseControlReply = true;
          await f.chat.operate(f.conversationId, 'original-control', 'message', { text: 'Keep the original deadline.' });
          Object.assign(f.foreground, { active: false, status: 'finished', ended: true });
        }
        if (boundary === 'terminal-unconfirmed' || boundary === 'pending-control') await f.chat.reconcile(f.conversationId, false);
        await f.sync(); f.goal();
        expect(f.evidence.content?.text).toBe(text);
        const execution = JSON.parse(f.execution().content!.text!);
        expect(execution.terminalConfirmed).toBe(false);
        expect(execution.foregroundActive || execution.pendingCommand).toBe(true);
        await Promise.all([f.runtime.tick(true), f.runtime.tick(true)]);
        expect(f.background).toHaveLength(0); expect(f.pursuit.currentActor).toBeUndefined();
        expect(f.runtime.accessForCaller('module:joined-mind:approved-mind-v1', true, f.foreground?.runId).execution).toBeUndefined();
        expect(() => f.actions.create(f.documentInput(), f.runtime.accessForCaller('unbound', true))).toThrow('responsibility');
        expect(f.actions.list(f.pursuit.id)).toHaveLength(0);
        f.sendGate?.release(); if (sending) await sending;
        await f.terminal(); await Promise.all([f.runtime.tick(true), f.runtime.tick(true)]);
        expect(f.background).toHaveLength(1);
        const worker = f.background[0]!;
        expect(f.pursuit.currentActor).toMatchObject({ actor: 'mind', runRef: worker.runId, stopRequested: false });
        expect(f.access(f.foreground).execution).toBeUndefined();
        expect(f.runtime.accessForCaller('same-app-without-current-run', true).execution).toBeUndefined();
        expect(f.runtime.accessForCaller('same-app-wrong-run', true, f.foreground.runId).execution).toBeUndefined();
        const target = { moduleId: mindIdentity.moduleId, tool: 'action' };
        const input = f.documentInput();
        const first = await f.tool(worker, target, input), replay = await f.tool(worker, target, input);
        expect(replay).toEqual(first); expect(f.actions.list(f.pursuit.id)).toHaveLength(1);
        await f.runtime.tick(true); expect(f.background).toHaveLength(1);
        expect(f.actions.list(f.pursuit.id)).toHaveLength(1); expect(f.pursuit.status).toBe('active');
        expect(f.calls.filter(c => c.principal.moduleId === mindIdentity.moduleId && c.args.runId === f.foreground.runId)).toHaveLength(0);
      } finally { f.sendGate?.release(); if (sending) await sending; f.close(); }
    });
  }

  test('concurrent explicit owner discoveries join one semantic pursuit; only actual current Run may execute once', async () => {
    const f = new Harness(); try {
      await f.send(); await f.sync();
      const discovered = await Promise.all(['foreground-discovery', 'mind-discovery'].map(async key => f.goal(key)));
      expect(discovered[0]!.id).toBe(discovered[1]!.id); expect(f.store.read().pursuits).toHaveLength(1);
      await f.runtime.tick(true); expect(f.background).toHaveLength(0);
      await f.terminal();
      await Promise.all([f.runtime.tick(true), f.runtime.tick(true), Promise.resolve().then(() => f.goal('late-same-goal'))]);
      expect(f.store.read().pursuits).toHaveLength(1); expect(f.background).toHaveLength(1);
      const worker = f.background[0]!, input = f.documentInput();
      expect(f.pursuit.currentActor?.runRef).toBe(worker.runId);
      expect(() => f.actions.create(input, f.access(f.foreground))).toThrow('responsibility');
      // A model can copy identifiers into JSON, but trusted current-Run metadata
      // still comes from the foreground caller and cannot gain Mind responsibility.
      expect(() => f.actions.create({ ...input, ...{ executionRunId: worker.runId,
        execution: { actor: 'mind', runRef: worker.runId } } }, f.access(f.foreground))).toThrow('responsibility');
      const result = await Promise.all([f.tool(worker, { moduleId: mindIdentity.moduleId, tool: 'action' }, input),
        f.tool(worker, { moduleId: mindIdentity.moduleId, tool: 'action' }, input)]);
      expect(result[0]).toEqual(result[1]); expect(f.actions.list(f.pursuit.id)).toHaveLength(1);
      expect(f.service.detail({ kind: 'pursuit', id: f.pursuit.id }, owner).currentActor?.runRef).toBe(worker.runId);
    } finally { f.close(); }
  });

  test('available provider followed by actual failed invocation remains visibly failed with finite retry, never done', async () => {
    const f = new Harness(); try {
      await f.send(); await f.sync(); await f.terminal();
      // Chat stamps its public feed with wall time. Start the controlled runtime
      // clock after those observations, so its no-op watermark covers the feed.
      f.now = new Date().toISOString();
      // Consume this feed through a genuine no-op understanding run before the
      // owner creates ongoing work; otherwise discovery is a separate valid run.
      await f.runtime.tick(true);
      const understanding = f.background[0]!;
      expect(understanding.args.tools as Target[]).toContainEqual({ moduleId: mindIdentity.moduleId, tool: 'pursue' });
      Object.assign(understanding, { active: false, ended: true, status: 'finished' });
      await f.runtime.tick(true, false, false);
      f.goal(); await f.runtime.tick(true);
      for (let attempt = 1; attempt <= 3; attempt++) {
        const worker = f.background.at(-1)!;
        expect(await f.tool(worker, 'agent.providers', {})).toMatchObject({ items: [{ available: true }] });
        // A health response cannot establish execution success. The accepted
        // provider invocation now returns a confirmed failed terminal outcome.
        f.failProviderStep.add(worker.runId);
        await f.runtime.tick(true);
        expect(f.runtime.view().retry[0]).toMatchObject({ attempts: attempt, error: 'Worker ended with failed status' });
        expect(f.pursuit.status).not.toBe('done'); expect(f.pursuit.currentActor).toBeUndefined();
        expect(f.actions.list(f.pursuit.id)).toHaveLength(0);
        const fact = f.runtime.journal.all().find(e => e.runId === worker.runId)!.facts[0]!;
        expect(fact).toMatchObject({ target: 'agent.providers', moduleId: 'system:agent', hash: 'kernel-contract-v1' });
        expect(f.runtime.capabilities?.tools.find(c => c.target === 'agent.providers')?.available).toBe(true);
        if (attempt < 3) {
          const due = f.runtime.view().retry[0]!.nextRetryAt!;
          f.now = new Date(Date.parse(due) - 1).toISOString(); await f.runtime.tick(true);
          expect(f.background).toHaveLength(attempt + 1); // One prior understanding, then worker attempts.
          f.now = due; await f.runtime.tick(true); expect(f.background).toHaveLength(attempt + 2);
        }
      }
      expect(f.runtime.view().retry[0]!.nextRetryAt).toBeNull();
      f.now = new Date(Date.parse(f.now) + 86_400_000).toISOString(); await f.runtime.tick(true); await f.runtime.tick(true);
      expect(f.background).toHaveLength(4); // The no-op understanding plus exactly three worker invocations.
      expect(f.providerInvocations.filter(x => x.outcome.startsWith('failed:'))).toHaveLength(3);
      expect(f.pursuit.status).not.toBe('done');
    } finally { f.close(); }
  });
});
