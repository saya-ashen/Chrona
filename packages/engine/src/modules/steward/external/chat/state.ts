import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateTools } from './tool-selection';
import { Observations } from './observations';
import { boundedMindContext } from './frontend-context';
export const APPLICATION_DELIVERY_GUIDANCE = '\n\nApplication delivery: when the user authorized creation, continue through existing Author.prepare/write/stage/submit and the actual owner entry modules.admit for the exact submitter, targets and baselines. Do not invent an external coordinator or ask again for the same authorization. Preserve original request keys and query original receipts after an unknown result. Never self-approve installation. A read-only prototype or finished Run is not completed delivery: report the exact candidate/receipt, or state the concrete blocker, responsible party and next action in this conversation. Missing public capabilities must be identified, not bypassed through private kernel state.\n';
export type Call = (target: any, args?: any, options?: any) => Promise<any>;
const now = () => new Date().toISOString();
const stable = (x: any): string => JSON.stringify(x);
const pending = (op: any) => !['succeeded', 'rejected', 'failed'].includes(op.status);
const refusalCodes = new Set(['invalid', 'forbidden', 'conflict', 'not_found', 'unavailable', 'failed']);
export function mergeTranscript(run: any, incoming: any[]) {
  const signature = (x: any) => stable(x);
  let tail = incoming;
  if (run.baseline?.length) {
    let overlap = Math.min(run.baseline.length, tail.length);
    while (overlap && stable(run.baseline.slice(-overlap)) !== stable(tail.slice(0, overlap))) overlap--;
    tail = tail.slice(overlap);
  }
  const saved = run.transcript ??= [];
  if (!tail.length) { run.rawTail = incoming; return; }
  let overlap = Math.min(saved.length, tail.length);
  // Match ordered blocks, allowing only the final aligned block to grow.
  // A timestamp belongs to a message and is not a unique block identity.
  while (overlap) {
    const start = saved.length - overlap;
    const prefixMatches = stable(saved.slice(start, -1)) === stable(tail.slice(0, overlap - 1));
    const old = saved.at(-1), next = tail[overlap - 1];
    if (prefixMatches && (stable(old) === stable(next) || (old.kind === 'text' && next.kind === 'text' && old.at === next.at && next.text.startsWith(old.text)))) {
      saved[saved.length - 1] = next; break;
    }
    overlap--;
  }
  // Providers can replace the latest partial text with a longer version.
  if (!overlap && saved.length) {
    const last = saved.at(-1), first = tail[0];
    if (last.kind === 'text' && first.kind === 'text' && last.at === first.at && first.text.startsWith(last.text)) {
      saved[saved.length - 1] = first;
      overlap = 1;
    }
  }
  if (!overlap && saved.length && tail.length) {
    run.gaps ??= [];
    if (!run.gaps.some((g: any) => g.from === signature(tail[0]))) run.gaps.push({ from: signature(tail[0]), message: 'Provider 返回的有界记录与已保存内容不相接；中间可能存在缺口。' });
  }
  const seen = new Set(saved.map(signature));
  for (const item of tail.slice(overlap)) if (!seen.has(signature(item))) { saved.push(item); seen.add(signature(item)); }
  run.transcriptStarted = true;
  run.rawTail = incoming;
  if (!run.baseline?.length && !run.initialTailChecked) {
    run.initialTailChecked = true;
    if (incoming.length >= 100) (run.gaps ??= []).push({ message: '首次读取达到 Provider 尾部上限，早期输出可能未保留。' });
  }
}
export class Store {
  db: Database;
  version = '';
  moduleId = '';
  mindTarget: { moduleId: string; tool: string } | null = null;
  observations: Observations;
  private invoking = new Map<string, Promise<void>>();
  constructor(public data: string, public content: string, public call: Call) {
    mkdirSync(data, { recursive: true }); mkdirSync(content, { recursive: true });
    this.db = new Database(join(data, 'chat.sqlite'));
    this.db.run('PRAGMA journal_mode=WAL');
    this.db.run('CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.db.run('CREATE TABLE IF NOT EXISTS create_requests (request_key TEXT PRIMARY KEY, empty_tools INTEGER NOT NULL, conversation_id TEXT NOT NULL)');
    this.observations = new Observations(this.db, () => ({ moduleId: this.moduleId, hash: this.version }));
  }
  save(c: any) {
    return this.db.transaction(() => {
      const row = this.db.query('SELECT value FROM conversations WHERE id=?').get(c.id) as any;
      const before = row ? JSON.parse(row.value) : null;
      c.updatedAt = now();
      this.db.query('INSERT OR REPLACE INTO conversations VALUES (?,?)').run(c.id, stable(c));
      this.observations.saved(before, c);
      return c;
    }).immediate();
  }
  get(id: string) {
    const row = this.db.query('SELECT value FROM conversations WHERE id=?').get(id) as any;
    if (!row) throw Error('会话不存在');
    return JSON.parse(row.value);
  }
  list() {
    return (this.db.query('SELECT value FROM conversations').all() as any[]).map(r => JSON.parse(r.value))
      .map(({ messages, operations, ...c }) => ({ ...c, messageCount: messages.length }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }
  created(requestKey: string, emptyTools = false) {
    if (typeof requestKey !== 'string' || !requestKey.trim() || requestKey.length > 128) throw Error('新建会话需要1至128字符的稳定requestKey');
    const prior = this.db.query('SELECT empty_tools, conversation_id FROM create_requests WHERE request_key=?').get(requestKey) as any;
    if (!prior) return null;
    if (!!prior.empty_tools !== emptyTools) throw Error('同一新建requestKey不能更改工具模式');
    // Keep the receipt after deletion: an old retry must never resurrect a conversation.
    try { return this.get(prior.conversation_id); } catch { throw Error('此新建请求对应的会话已删除，请使用新的requestKey'); }
  }
  create(providerId = '', tools: any[] = [], requestKey?: string, emptyTools = false) {
    return this.db.transaction(() => {
      if (requestKey !== undefined) { const prior = this.created(requestKey, emptyTools); if (prior) return prior; }
      validateTools(tools);
      const c = this.save({ id: randomUUID(), title: '新会话', pinned: false, archived: false, draft: '', attachments: [], settings: { providerId, model: '', thinking: '', tools: structuredClone(tools) }, context: null, active: null, messages: [], operations: [], deliveries: [], revision: 0 });
      if (requestKey !== undefined) this.db.query('INSERT INTO create_requests VALUES (?,?,?)').run(requestKey, Number(emptyTools), c.id);
      return c;
    }).immediate();
  }
  draft(id: string, patch: any, revision: number) {
    const c = this.get(id);
    if (!Number.isInteger(revision) || c.revision !== revision) throw Error('草稿已在其他窗口更新，请核对后编辑');
    if (typeof patch.draft === 'string') c.draft = patch.draft.slice(0, 200000);
    if (patch.settings) {
      const s = patch.settings;
      if (!['providerId', 'model', 'thinking'].every(k => typeof s[k] === 'string') || !Array.isArray(s.tools)) throw Error('无效的会话设置');
      validateTools(s.tools);
      c.settings = s;
    }
    c.revision++;
    return this.save(c);
  }
  edit(id: string, patch: any) {
    const c = this.get(id);
    for (const k of ['title', 'pinned', 'archived']) if (k in patch) {
      if (k === 'title' && (typeof patch[k] !== 'string' || !patch[k].trim() || patch[k].length > 120)) throw Error('名称须为1至120个字符');
      if (k !== 'title' && typeof patch[k] !== 'boolean') throw Error('标记须为布尔值');
      c[k] = patch[k];
    }
    return this.save(c);
  }
  delete(id: string, confirmed: boolean) {
    const c = this.get(id);
    if (!confirmed) throw Error('需要确认删除');
    if (c.active || c.operations.some(pending)) throw Error('任务或请求尚未确认，暂不能删除');
    const files = new Set([...c.attachments, ...c.messages.flatMap((m: any) => m.attachments ?? [])].map((a: any) => a.file));
    for (const file of files) { try { unlinkSync(join(this.content, String(file))); } catch (e: any) { if (e.code !== 'ENOENT') throw e; } }
    return this.db.transaction(() => {
      this.db.query('DELETE FROM conversations WHERE id=?').run(id);
      this.observations.deleted(id);
      return { deleted: id };
    }).immediate();
  }
  upload(id: string, args: any) {
    const c = this.get(id);
    if (c.attachments.length >= 10) throw Error('最多10个附件');
    const types: any = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
    if (!types[args.mime]) throw Error('仅支持 PNG、JPEG、GIF、WebP；PDF 不支持自动解析');
    const bytes = Buffer.from(args.base64, 'base64');
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw Error('单张图片须小于2MiB');
    const magic = (args.mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || (args.mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) || (args.mime === 'image/gif' && bytes.toString('ascii', 0, 3) === 'GIF') || (args.mime === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
    if (!magic) throw Error('图片内容与格式不匹配');
    const file = randomUUID() + '.' + types[args.mime];
    writeFileSync(join(this.content, file), bytes, { mode: 0o600 });
    c.attachments.push({ id: randomUUID(), file, ref: 'chat/' + file, name: String(args.name).slice(0, 200), mime: args.mime, size: bytes.length });
    c.revision++;
    return this.save(c);
  }
  detach(id: string, attachmentId: string) {
    const c = this.get(id), a = c.attachments.find((a: any) => a.id === attachmentId);
    if (!a) return c;
    if (c.operations.some((o: any) => o.kind === 'send' && pending(o) && o.snapshot?.attachments?.some((x: any) => x.id === a.id))) throw Error('待确认的发送仍引用此图片，请先核对请求');
    c.attachments = c.attachments.filter((x: any) => x.id !== attachmentId);
    unlinkSync(join(this.content, a.file)); c.revision++;
    return this.save(c);
  }
  image(id: string, attachmentId: string) {
    const c = this.get(id), a = [...c.attachments, ...c.messages.flatMap((m: any) => m.attachments ?? [])].find((a: any) => a.id === attachmentId);
    if (!a) throw Error('附件不属于此会话');
    return { mime: a.mime, base64: readFileSync(join(this.content, a.file)).toString('base64') };
  }
  async operate(id: string, key: string, kind: string, input: any) {
    try { return await this.perform(id, key, kind, input); }
    catch (e: any) {
      const c = this.get(id);
      // No saved operation means perform never reached its external write. Record that proof.
      // Existing operations and storage/transport failures after dispatch are never recast as refusal.
      if (!key || c.operations.some((op: any) => op.key === key)) throw e;
      const error = { code: e.code ?? 'invalid', message: e.message ?? String(e), at: now() };
      c.operations.push({ protocol: 'sync-agent-v2', applicationHash: this.version, key, kind, input, sourceAdmission: this.observations.admission(id), status: 'rejected', stage: 'preflight', notAccepted: true, error: error.message, errorCode: error.code, errors: [error], createdAt: now() });
      return this.save(c);
    }
  }
  private async perform(id: string, key: string, kind: string, input: any,
    providers?: Awaited<ReturnType<Call>>): Promise<ReturnType<Store['get']>> {
    let c = this.get(id);
    if (!key || key.length > 128) throw Error('需要稳定调用 key');
    const prior = c.operations.find((o: any) => o.key === key);
    if (prior) {
      if (stable(prior.input) !== stable(input) || prior.kind !== kind) throw Error('同一调用 key 的请求不能改变');
      if (pending(prior)) await this.invoke(id, key);
      return this.reconcile(id, false);
    }
    if (c.operations.some(pending)) throw Error('已有未确认请求，请先核对原请求');
    if (kind === 'send' && c.active) throw Error('已有任务或未读完记录，请先核对');
    if (kind === 'send' && c.context && this.version && c.context.applicationHash !== this.version) throw Error('旧应用版本的执行上下文不可续接；消息已保留，请显式开始新执行上下文');
    if (kind !== 'send' && !c.active?.runId) throw Error('没有可控制的已知任务');
    let target = 'agent.run', args: any;
    let snapshot = { draft: c.draft, revision: c.revision, attachments: structuredClone(c.attachments) };
    if (kind !== 'send' && input.runId && input.runId !== c.active.runId) throw Error('原任务已变化，不能将旧操作应用到下一轮');
    if (kind === 'send' && input.snapshot) {
      const s = input.snapshot;
      if (typeof s.draft !== 'string' || !Array.isArray(s.attachmentIds) || !s.settings) throw Error('发送快照无效');
      const attachments = s.attachmentIds.map((id: string) => c.attachments.find((a: any) => a.id === id));
      if (attachments.some((a: any) => !a)) throw Error('原发送引用的图片已不在待发送列表，未启动任务');
      snapshot = { draft: s.draft, revision: s.revision, attachments };
    }
    if (kind === 'message') snapshot = { draft: input.text, revision: input.draftSnapshot?.revision ?? -1, attachments: [] };
    const sending = { ...c, ...snapshot, settings: input.snapshot?.settings ?? c.settings };
    if (kind === 'send') {
      if (!sending.draft.trim() && !sending.attachments.length) throw Error('请输入消息');
      // Provider discovery yields. Re-enter against current conversation state before reserving a send.
      if (!providers) return this.perform(id, key, kind, input, await this.call('agent.providers', {}));
      const p = providers.items.find((p: any) => p.id === sending.settings.providerId);
      if (!p?.available || !p.capabilities.conversation) throw Error('请先选择可用的对话提供方');
      if (c.context && (c.context.providerId !== p.id || c.context.hash !== p.hash || c.context.revision !== p.revision)) throw Error('提供方或版本已改变，请新建会话');
      if (sending.attachments.length && !p.capabilities.images) throw Error('此提供方不支持图片');
      validateTools(sending.settings.tools);
      args = { providerId: p.id, ...(c.context ? { contextId: c.context.contextId } : {}), prompt: sending.draft.trim() || '请查看附图', content: sending.attachments.map((a: any) => a.ref), lane: 'foreground', tools: sending.settings.tools, providerOptions: { ...(sending.settings.model ? { model: sending.settings.model } : {}), ...(sending.settings.thinking ? { thinking: sending.settings.thinking } : {}) }, kind: 'conversation' };
      c.active = { key, status: '正在提交', providerId: p.id, hash: p.hash, revision: p.revision, settings: structuredClone(sending.settings), cursor: '', seen: [], events: [], interactions: [], transcript: [], baseline: c.context?.transcript ?? [] };
    } else if (kind === 'stop') {
      target = 'agent.stop'; args = { runId: c.active.runId };
      c.active.stopRequested = true; c.active.status = '正在确认停止';
    } else if (kind === 'message') {
      if (!input.text?.trim()) throw Error('补充指令不能为空');
      target = 'agent.write'; args = { runId: c.active.runId, input: { kind: 'message', text: input.text } };
    } else if (kind === 'answer') {
      target = 'agent.write'; args = { runId: c.active.runId, input: { kind: 'answer', questionId: input.questionId, answer: input.answer } };
    } else throw Error('未知操作');
    const createdAt = now();
    // Submission is a user fact even when the Provider later refuses the execution.
    // Preflight refusals above retain only the draft and a visible operation error.
    if (kind === 'send' || kind === 'message') c.messages.push({ id: key, role: 'user', text: snapshot.draft, attachments: snapshot.attachments, ...(kind === 'message' ? { runId: c.active.runId } : {}), at: createdAt });
    c.operations.push({ protocol: 'sync-agent-v2', applicationHash: this.version, key, kind, input, target, args, contextState: kind === 'send' || kind === 'message' ? 'pending' : 'none', sourceAdmission: this.observations.admission(id), status: 'prepared', snapshot, createdAt, errors: [] });
    this.save(c);
    await this.invoke(id, key);
    return this.reconcile(id, false);
  }
  async invoke(id: string, key: string) {
    const identity = stable([id, key]);
    const running = this.invoking.get(identity);
    if (running) return running;
    const task = this.invokeOnce(id, key);
    this.invoking.set(identity, task);
    try { await task; } finally { this.invoking.delete(identity); }
  }
  private async invokeOnce(id: string, key: string) {
    let c = this.get(id), op = c.operations.find((o: any) => o.key === key);
    if (!op || !pending(op)) return;
    if (this.version && op.applicationHash && op.applicationHash !== this.version) {
      op.status = 'version-blocked'; op.recoveryNotice = '原命令绑定其他应用版本，当前版本无法核对；保留未知占用，不重放。'; this.save(c); return;
    }
    if (op.protocol !== 'sync-agent-v2') {
      op.status = 'legacy-unverified';
      op.recoveryNotice = '旧版使用被宿主禁止的异步调用；缺少原始未受理证据，保留原记录且不重发。';
      this.save(c); return;
    }
    if (op.contextState === 'pending') {
      const admission = op.sourceAdmission;
      // Recovery must not transmit an old submission after withdrawal or later opt-in.
      const admitted = () => !!admission && this.observations.admission(id) === admission;
      const skipped = { text: '', status: 'Mind 上下文已跳过：当前提交未获学习范围授权，继续当前对话' };
      let context = admitted() ? await boundedMindContext(
        (target, args) => admitted() ? this.call(target, args) : Promise.resolve(null),
        this.mindTarget, op.snapshot.draft, id,
      ) : skipped;
      // The lookup awaited an ordinary application. Re-read mutable draft/scope before
      // binding the exact command; recovery reuses it and never fetches context again.
      c = this.get(id); op = c.operations.find((o: any) => o.key === key);
      if (!admitted()) context = skipped;
      const evidence = admitted() ? this.observations.evidence(id, key) : null;
      const reference = evidence ? '\n\nVerified submitted user evidence (reference only; no additional authority):\n' + JSON.stringify(evidence) : '';
      const prompt = (op.kind === 'send' ? op.args.prompt : op.args.input.text) + APPLICATION_DELIVERY_GUIDANCE + context.text + reference;
      if (op.kind === 'send') op.args.prompt = prompt;
      else op.args.input.text = prompt;
      op.contextState = 'ready'; c.mindContextStatus = context.status;
      this.save(c);
    }
    try {
      // The Agent keeps its own command receipt. Exact same key and arguments reconcile it.
      const output = await this.call(op.target, op.args, { key: op.key });
      c = this.get(id); op = c.operations.find((o: any) => o.key === key);
      op.output = output; op.status = op.kind === 'stop' && output.stopConfirmed !== true ? 'unconfirmed' : 'succeeded';
      this.apply(c, op);
    } catch (e: any) {
      c = this.get(id); op = c.operations.find((o: any) => o.key === key);
      const error = { code: e.code ?? 'transport', message: e.message ?? String(e), at: now() };
      op.errors ??= [];
      const last = op.errors.at(-1);
      if (last?.code === error.code && last.message === error.message) last.repeats = (last.repeats ?? 1) + 1;
      else op.errors.push(error);
      op.error = error.message; op.errorCode = error.code;
      const refusal = refusalCodes.has(error.code) && !op.effectUnknown;
      op.status = refusal ? 'rejected' : 'unknown';
      if (!refusal) op.effectUnknown = true;
      if (refusal && op.kind === 'send' && c.active?.key === key) c.active = null;
    }
    this.save(c);
  }
  apply(c: any, op: any) {
    if (op.applied && op.kind !== 'stop') return;
    const out = op.output;
    if (op.kind === 'send') {
      if (!out?.runId || !out.contextId) throw Error('执行回执不完整');
      if (c.active?.key !== op.key) throw Error('执行回执与原请求不一致');
      Object.assign(c.active, { runId: out.runId, contextId: out.contextId, status: out.status });
      c.context = { applicationHash: this.version, contextId: out.contextId, providerId: c.active.providerId, hash: c.active.hash, revision: c.active.revision, transcript: c.context?.transcript ?? [] };
      if (!c.messages.some((m: any) => m.id === op.key)) c.messages.push({ id: op.key, role: 'user', text: op.snapshot.draft, attachments: op.snapshot.attachments, at: op.createdAt });
      if (c.revision === op.snapshot.revision && c.draft === op.snapshot.draft) { c.draft = ''; c.revision++; }
      c.attachments = c.attachments.filter((a: any) => !op.snapshot.attachments.some((b: any) => b.id === a.id));
    } else {
      const runId = op.args.runId;
      const run = c.active?.runId === runId ? c.active : c.messages.find((m: any) => m.run?.runId === runId)?.run;
      if (op.kind === 'stop') {
        if (out?.runId !== runId) throw Error('停止回执身份不一致');
        if (run) { run.stopRequested = true; run.stopConfirmed = out.stopConfirmed === true; run.status = run.stopConfirmed ? '已停止' : '停止未确认'; }
      }
      if (op.kind === 'message' && !c.messages.some((m: any) => m.id === op.key)) {
        c.messages.push({ id: op.key, role: 'user', text: op.input.text, runId, at: op.createdAt });
        if (c.revision === op.snapshot.revision && c.draft === op.snapshot.draft) { c.draft = ''; c.revision++; }
      }
    }
    op.applied = true;
  }
  async reconcile(id: string, recover = true) {
    let c = this.get(id);
    if (recover) for (const op of c.operations.filter(pending)) await this.invoke(id, op.key);
    c = this.get(id);
    if (!c.active?.runId) return c;
    let a = c.active;
    const runId = a.runId, key = a.key;
    let cursor = a.cursor ?? '';
    if (this.version && c.context?.applicationHash !== this.version) {
      a.accessBlocked = true; a.error = '旧应用版本的 Run 不可访问，状态保持未知；消息记录已保留。'; return this.save(c);
    }
    try {
      // Terminal is a Run state, not the end of the event cursor. Drain bounded pages.
      for (let page = 0; page < 5; page++) {
        cursor = a.cursor ?? '';
        const r = await this.call('agent.read', { runId, cursor, limit: 100, waitMs: 0 });
        // Drafts and controls can change while the gateway is reading. Merge only
        // into the current actor; another reader may also have advanced its cursor.
        c = this.get(id);
        if (c.active?.runId !== runId || c.active.key !== key || (c.active.cursor ?? '') !== cursor) return c;
        a = c.active;
        if (r.run.runId !== runId) throw Error('执行身份不一致');
        const seen = new Set(a.seen);
        for (const item of r.items) if (!seen.has(item.sequence)) { seen.add(item.sequence); (a.events ??= []).push(item); }
        a.seen = [...seen]; if (r.nextCursor) a.cursor = r.nextCursor; a.interactions = r.interactions;
        if (r.transcript) mergeTranscript(a, r.transcript);
        a.ended = r.ended; a.runActive = r.run.active; a.observedStatus = r.run.status; a.drained = r.ended && !r.nextCursor;
        a.status = a.stopRequested ? (a.stopConfirmed ? '已停止' : '停止未确认') : r.run.status;
        a.error = null;
        if (!r.ended || !r.nextCursor) break;
        if (page < 4) this.save(c);
      }
      const uncertain = c.operations.some((op: any) => pending(op) && (op.args?.runId === a.runId || op.key === a.key));
      if (a.ended && !a.runActive && a.drained && (!a.stopRequested || a.stopConfirmed) && !uncertain) {
        c.context.transcript = a.rawTail ?? [];
        c.messages.push({ id: a.runId, role: 'assistant', text: '', at: now(), run: structuredClone(a) });
        c.active = null;
      } else if (a.ended && !a.drained && !a.stopRequested) a.status = '正在读取剩余记录';
    } catch (e: any) {
      c = this.get(id);
      if (c.active?.runId !== runId || c.active.key !== key || (c.active.cursor ?? '') !== cursor) return c;
      a = c.active;
      a.error = e.message;
      a.status = a.stopRequested ? (a.stopConfirmed ? '已停止' : '停止未确认') : '状态暂不可核对';
    }
    return this.save(c);
  }
  newContext(id: string, confirmed: boolean) {
    const c = this.get(id);
    if (!confirmed || c.active || c.operations.some(pending)) throw Error('仍有未确认执行，不能切换上下文');
    c.context = null; c.contextNotice = '已显式开始新执行上下文，保留 Chat 消息；旧 Provider 上下文不会续接。';
    return this.save(c);
  }
  close() { this.db.close(); }
}
