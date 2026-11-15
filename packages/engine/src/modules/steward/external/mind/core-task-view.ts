import type { CoreMindStore } from './core-store';
import type { CoreMindService } from './core-service';
import type { CoreActions } from './core-actions';
import type { CoreAccess, CoreState, Pursuit } from './core-types';
import { CoreError } from './core-types';
import type { Execution } from './core-execution';
import type { CoreDelivery } from './core-delivery';
import { taskTitle } from './core-display';
export { taskTitle } from './core-display';

type Caller = { kind: string; moduleId?: string; module?: string; hash?: string; via?: string | null };
function ownerCallback(caller: Caller, chain: string[] | undefined, dependencies: Record<string, string>) {
  if (caller.kind !== 'module') return undefined;
  if (dependencies.web && caller.moduleId === dependencies.web) return `web:${caller.moduleId}`;
  // Chat admits the real Web callback before the kernel appends its module to the chain.
  if (dependencies.chat && caller.moduleId === dependencies.chat && chain?.at(-2) === 'web' && chain.at(-1) === 'chat')
    return `chat-owner-callback:${caller.moduleId}`;
  return undefined;
}
/** The SDK supplies these principals and chain; task JSON never grants owner access.
 * Receipt subjects retain module identity across approved version updates. */
export function taskOwnerAccess(caller: Caller | undefined, chain: string[] | undefined, dependencies: Record<string, string>): CoreAccess {
  const subject = caller?.kind === 'owner' ? `owner:${caller.via ?? 'local'}` : caller && ownerCallback(caller, chain, dependencies);
  if (subject) return { subject, role: 'owner', scopes: [{}] };
  throw new CoreError('FORBIDDEN', 'Only the owner Web callback may access tasks');
}

export function taskGoal(goal: string) {
  // Each correction appends a supplement after the original authorization metadata.
  // Strip metadata within each section so every later owner supplement stays readable.
  return goal.split(/(\n\s*补充要求[：:])/).map(section => section.split(/\n\s*(?:\[Application feedback context\]|\[应用反馈上下文\]|反馈(?:对应版本|页面)[：:]|(?:Feedback|反馈)(?: context|元数据)?[:：]|(?:pageId|pageRevision|moduleId|activeHash|pursuitId|runId)\s*[:=])/i)[0]!).join('').trim();
}

type TaskSources = {
  chatIdentity: () => string | undefined;
  deliveries?: Pick<CoreDelivery, 'list' | 'detail'>;
};
type DeliveryView = ReturnType<CoreDelivery['list']>['items'][number] & { updatedAt: string };
type Operation = { operation: string; status: string; at: string; observation?: string; needsDecision?: boolean };
const actionLabels: Record<string, string> = { document: '生成文档', 'application-read': '读取应用资料' };
const toolLabels: Record<string, string> = {
  source: '读取应用源码', read: '读取应用文件', write: '修改应用文件', prepare: '准备开发材料',
  export: '导出开发材料', import: '导入开发材料', validate: '检查应用材料', stage: '准备交付材料',
  'modules.admit': '确认应用修改范围', receipt: '查询交付回执', delivery: '处理应用交付',
};
function runOperations(runs: Execution[]): Operation[] {
  return runs.flatMap(run => run.facts.flatMap(fact => {
    const tool = typeof fact.target === 'string' ? fact.target : fact.target.tool;
    const operation = toolLabels[tool];
    return operation ? [{ operation, status: fact.status, at: fact.at ?? run.createdAt }] : [];
  }));
}
function taskOperations(state: CoreState, p: Pursuit, runs: Execution[], deliveries: DeliveryView[]) {
  const actions = state.actions.filter(a => a.pursuitId === p.id).map(a => ({
    operation: actionLabels[a.target] ?? '执行应用操作', status: a.outcome, at: a.at,
  }));
  const deliveryOperations = deliveries.map(d => ({
    operation: '处理应用交付', status: d.status, at: d.updatedAt, observation: d.observation, needsDecision: d.needsDecision,
  }));
  return [...actions, ...runOperations(runs), ...deliveryOperations].sort((a, b) => a.at.localeCompare(b.at));
}
function lastActivity(p: Pursuit, runs: Execution[], operations: Operation[], progressAt?: string) {
  const dates = [p.updatedAt, ...operations.map(a => a.at)];
  for (const run of runs) {
    dates.push(run.createdAt, run.activityStartedAt ?? run.createdAt);
    for (const fact of run.facts) dates.push(fact.at ?? run.createdAt);
  }
  if (progressAt) dates.push(progressAt);
  return dates.sort().at(-1);
}
function conversationId(state: CoreState, p: Pursuit, chatIdentity: string | undefined) {
  // Evidence refs preserve association order when later evidence is merged into a pursuit.
  // Missing/expired/retracted origins cannot safely be reconstructed from scrubbed journals.
  for (const ref of p.evidenceRefs) {
    const evidence = state.evidence.find(e => e.id === ref);
    if (evidence && evidence.sourceIdentity === chatIdentity && !evidence.retractedAt && !evidence.expiredAt)
      return evidence.origin.rootId;
  }
  return undefined;
}
function taskStatus(p: Pursuit) {
  if (p.status === 'ended') return 'ended';
  return p.paused ? 'paused' : p.status;
}
type Control = {
  id: string; expectedRevision: number; expectedVisibilityRevision: number; actionKey: string;
  operation: 'supplement' | 'pause' | 'resume'; text?: string; goal?: string;
};
function supplementValue(input: Control, p: Pursuit) {
  if (!input.text?.trim() || typeof input.goal !== 'string') throw new CoreError('INVALID_INPUT', '请填写补充要求');
  if (p.revision === input.expectedRevision && input.goal !== p.goal) throw new CoreError('CONFLICT', '任务内容已改变，请重新读取');
  return `${input.goal}\n\n补充要求：\n${input.text.trim()}`;
}

/** Recomputed from existing pursuit, evidence, execution and delivery records. No persisted replica. */
export class CoreTaskView {
  private readonly sources: TaskSources;
  constructor(private readonly store: CoreMindStore, private readonly service: CoreMindService,
    private readonly actions: Pick<CoreActions, 'list' | 'read'>, private readonly executions: () => Execution[],
    sources: TaskSources | (() => string | undefined)) {
    this.sources = typeof sources === 'function' ? { chatIdentity: sources } : sources;
  }
  private owner(who: CoreAccess) {
    if (who.role !== 'owner') throw new CoreError('FORBIDDEN', 'Task conversations require owner access');
    if (this.store.read().settings.restoreBlocked) throw new CoreError('RESTORE_BLOCKED', 'Restored tasks need owner review in Mind');
  }
  private deliveries(who: CoreAccess) {
    const source = this.sources.deliveries;
    const result: DeliveryView[] = [];
    if (!source) return result;
    let after: string | undefined;
    do {
      const page = source.list({ limit: 50, ...(after ? { after } : {}) }, who);
      result.push(...page.items.map(item => ({ ...item, updatedAt: source.detail(item.id, who).updatedAt })));
      after = page.nextCursor ?? undefined;
    } while (after);
    return result;
  }
  private project(p: Pursuit, state: CoreState, runs: Execution[], deliveries: DeliveryView[]) {
    const taskRuns = runs.filter(e => ['pursuit', 'opportunity'].includes(e.purpose) && e.subject === p.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const taskDeliveries = deliveries.filter(d => d.pursuitId === p.id);
    const progress = state.candidates.filter(c => c.pursuitId === p.id && c.state === 'applied')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).at(0);
    const operations = taskOperations(state, p, taskRuns, taskDeliveries);
    return {
      id: p.id, revision: p.revision, visibilityRevision: state.visibilityRevision, title: taskTitle(p.goal), goal: taskGoal(p.goal),
      status: taskStatus(p), waitFor: p.waitFor, waitReason: p.waitReason, nextStep: p.nextStep,
      lastActivity: lastActivity(p, taskRuns, operations, progress?.updatedAt),
      summary: progress?.summary || taskRuns.at(0)?.summary || (p.currentActor ? '正在继续处理任务' : '任务已保留，等待下一步'),
      conversationId: conversationId(state, p, this.sources.chatIdentity()), artifactRefs: p.artifactRefs, operations,
      details: {
        goal: p.goal, completionCriteria: p.completionCriteria, currentActor: p.currentActor,
        runs: taskRuns.map(e => ({ id: e.runId, status: e.status, terminalStatus: e.terminalStatus, createdAt: e.createdAt, error: e.error })),
        deliveries: taskDeliveries, verification: p.verification,
      },
    };
  }
  view(args: { id?: string; artifactRef?: string }, who: CoreAccess) {
    this.owner(who);
    const state = this.store.read(), runs = this.executions(), deliveries = this.deliveries(who);
    if (!args.id) return {
      items: state.pursuits.filter(p => p.goal).map(p => this.project(p, state, runs, deliveries))
        .sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '')),
    };
    const p = this.service.detail({ kind: 'pursuit', id: args.id }, who) as Pursuit;
    if (!p.goal) throw new CoreError('NOT_FOUND', 'Task is no longer available');
    if (args.artifactRef) {
      const artifacts = this.actions.list(p.id, who);
      if (!artifacts.some(a => a.ref === args.artifactRef)) throw new CoreError('NOT_FOUND', 'Artifact does not belong to this task');
      return this.actions.read(args.artifactRef, who);
    }
    return { ...this.project(p, state, runs, deliveries), artifacts: this.actions.list(p.id, who) };
  }
  control(input: Control, who: CoreAccess) {
    this.owner(who);
    if (!['supplement', 'pause', 'resume'].includes(input.operation)) throw new CoreError('INVALID_INPUT', 'Expected supplement, pause or resume');
    const p = this.service.detail({ kind: 'pursuit', id: input.id }, who) as Pursuit;
    return this.service.control({
      kind: 'pursuit', id: p.id, expectedRevision: input.expectedRevision,
      expectedVisibilityRevision: input.expectedVisibilityRevision, actionKey: input.actionKey,
      operation: input.operation === 'supplement' ? 'correct' : input.operation,
      ...(input.operation === 'supplement' ? { value: supplementValue(input, p) } : {}),
    }, who);
  }
}
