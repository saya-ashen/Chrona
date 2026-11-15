type Api = (name: string, args?: Record<string, unknown>) => Promise<unknown>;
type Task = {
  id: string; title: string; status: string; waitFor?: string; lastActivity: string;
  revision: number; visibilityRevision: number; goal: string; summary: string;
  waitReason?: string; nextStep?: string; conversationId?: string;
  operations?: { operation: string; status: string; at: string; observation?: string; needsDecision?: boolean }[];
  artifacts?: { ref: string; title: string }[];
  details: { goal: string; [key: string]: unknown };
};
type Operation = 'supplement' | 'pause' | 'resume';
type ConversationReader = (id: string, stillSelected: () => boolean) => Promise<void>;
const labels: Record<string, string> = {
  candidate: '待核对', active: '正在处理', paused: '已暂停', done: '已核验完成', ended: '已结束',
  user: '等待你反馈', permission: '等待授权', verification: '等待核验', external: '等待外部结果',
  provider: '等待提供方', budget: '等待资源', intent: '已请求，结果待确认', unknown: '结果待确认',
  succeeded: '已执行', failed: '执行失败', 'awaiting-worker-proof': '等待材料证明',
  'coordinator-ready': '材料已就绪', 'submit-unknown': '原提交结果未知', submitted: '已有提交回执',
  rejected: '交付已被拒绝', withdrawn: '已撤回', pending_approval: '等待审批', approved: '已批准',
};
const statusText = (task: Task) => task.status === 'waiting'
  ? labels[task.waitFor ?? ''] ?? '等待继续' : labels[task.status] ?? '状态待核对';
const timeText = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间待核对' : date.toLocaleString('zh-CN');
};
const readable = (text: string) => text.replace(/\b(?:[a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\b/gi, '（详见技术记录）');
const find = <T extends HTMLElement>(root: HTMLElement, selector: string) => root.querySelector(selector) as T;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const log = (event: string, error: unknown) => console.error(JSON.stringify({ component: 'chat', event, error: message(error) }));
const pendingKey = (id: string) => `chrona:chat:task-control:${id}`;
function definiteFailure(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String(error.code).toUpperCase().replace(/-/g, '_');
  return ['CONFLICT', 'INVALID_INPUT', 'INVALID', 'FORBIDDEN', 'NOT_FOUND', 'RESTORE_BLOCKED', 'REJECTED'].includes(code);
}
function paragraph(text: string) {
  const node = document.createElement('p'); node.textContent = text; return node;
}
function overview(box: HTMLElement, detail: Task) {
  const expanded = box.querySelector('details')?.open;
  const title = document.createElement('h2'); title.textContent = detail.title;
  const status = paragraph(`${statusText(detail)} · 最近活动 ${timeText(detail.lastActivity)}`); status.className = 'chat-task-status';
  box.replaceChildren(title, status, paragraph(readable(detail.goal)), paragraph(`进展：${readable(detail.summary)}`));
  if (detail.waitReason) box.append(paragraph(`等待原因：${readable(detail.waitReason)}`));
  if (detail.nextStep) box.append(paragraph(`下一步：${readable(detail.nextStep)}`));
  const operations = document.createElement('ul');
  for (const operation of detail.operations ?? []) {
    const item = document.createElement('li');
    item.textContent = `${operation.operation} · ${labels[operation.status] ?? operation.status} · ${timeText(operation.at)}`;
    if (operation.observation) item.append(paragraph(readable(operation.observation)));
    if (operation.needsDecision) item.append(paragraph('需要你处理：请前往 Mind 查看交付并作出决定。'));
    operations.append(item);
  }
  if (operations.children.length) box.append(operations);
  const technical = document.createElement('details'), heading = document.createElement('summary'), pre = document.createElement('pre');
  heading.textContent = '技术记录'; pre.textContent = JSON.stringify({ id: detail.id, revision: detail.revision, ...detail.details }, null, 2);
  technical.append(heading, pre); technical.open = !!expanded; box.append(technical);
}
function layout(root: HTMLElement) {
  const sidebar = document.createElement('section'); sidebar.className = 'chat-tasks'; sidebar.setAttribute('aria-label', '后台任务');
  sidebar.innerHTML = '<div class="chat-task-heading"><b>后台任务</b><button type="button" class="chat-tasks-refresh">刷新</button></div><p class="chat-task-load" role="status">正在加载任务…</p><nav aria-label="后台任务列表"></nav>';
  root.querySelector('.chat-sidebar')!.append(sidebar);
  const panel = document.createElement('section'); panel.className = 'chat-task-panel'; panel.hidden = true; panel.setAttribute('aria-label', '任务进展');
  panel.innerHTML = '<div class="chat-task-overview"></div><div class="chat-task-artifacts"></div><div class="chat-task-artifact" hidden></div><p class="chat-task-notice" role="status"></p><form class="chat-task-form"><label>补充任务要求<textarea aria-label="补充任务要求" rows="2" placeholder="补充验收标准、回答问题或说明下一步…"></textarea></label><div><button type="submit">发送补充</button><button type="button" class="chat-task-pause">暂停任务</button><button type="button" class="chat-task-resume">继续任务</button><button type="button" class="chat-task-retry" hidden>核对原请求</button><button type="button" class="chat-task-close">返回对话</button></div></form>';
  root.querySelector('.chat-main')!.append(panel);
  return { sidebar, panel };
}

/** Live task views are never copied to Chat messages or a second conversation store. */
class TaskWorkbench {
  private readonly sidebar: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly search: HTMLInputElement;
  private items: Task[] = [];
  selected: string | undefined;
  private current: Task | undefined;
  private linkedConversation: string | undefined;
  private signature = '';
  private dead = false;
  private loading = false;
  private generation = 0;
  private controlling = false;
  constructor(private readonly root: HTMLElement, private readonly api: Api,
    private readonly selectConversation: ConversationReader, private readonly onClose: () => void) {
    const nodes = layout(root); this.sidebar = nodes.sidebar; this.panel = nodes.panel;
    this.notice = find(this.sidebar, '.chat-task-load'); this.nav = find(this.sidebar, 'nav');
    this.search = find(root, '.chat-search'); this.search.addEventListener('input', this.drawList);
    this.q<HTMLFormElement>('.chat-task-form').onsubmit = event => { event.preventDefault(); void this.control('supplement'); };
    this.q('.chat-task-pause').onclick = () => void this.control('pause');
    this.q('.chat-task-resume').onclick = () => void this.control('resume');
    this.q('.chat-task-retry').onclick = () => void this.control();
    this.q('.chat-task-close').onclick = () => this.close();
    find(this.sidebar, 'button').onclick = () => void this.refresh();
  }
  private q<T extends HTMLElement = HTMLElement>(selector: string) { return find<T>(this.panel, selector); }
  private pending() { return this.selected ? localStorage.getItem(pendingKey(this.selected)) : null; }
  private alive() { return !this.dead; }
  private active(id: string, token: number) { return this.alive() && this.selected === id && token === this.generation; }
  private async taskApi<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const value = await this.api(name, args) as T & { error?: { code: string; message: string } };
    if (value.error) throw Object.assign(Error(value.error.message), { code: value.error.code });
    return value;
  }
  private drawList = () => {
    this.nav.replaceChildren();
    const search = this.search.value.toLocaleLowerCase();
    for (const item of this.items.filter(task => task.title.toLocaleLowerCase().includes(search))) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.taskId = item.id;
      button.className = item.id === this.selected ? 'chat-selected' : ''; button.setAttribute('aria-current', item.id === this.selected ? 'page' : 'false');
      const title = document.createElement('span'), status = document.createElement('small');
      title.textContent = item.title; status.textContent = `${statusText(item)} · ${timeText(item.lastActivity)}`;
      button.append(title, status); button.onclick = () => void this.select(item.id); this.nav.append(button);
    }
  };
  private lock() {
    const waiting = !!this.pending(), disabled = this.controlling || waiting || !this.current;
    this.q<HTMLTextAreaElement>('textarea').disabled = disabled || this.current?.status === 'ended';
    this.q<HTMLButtonElement>('[type="submit"]').disabled = this.q<HTMLTextAreaElement>('textarea').disabled;
    this.q('.chat-task-pause').hidden = !!this.current && ['paused', 'done', 'ended'].includes(this.current.status);
    this.q('.chat-task-resume').hidden = !this.current || !['paused', 'waiting'].includes(this.current.status);
    this.q<HTMLButtonElement>('.chat-task-pause').disabled = disabled;
    this.q<HTMLButtonElement>('.chat-task-resume').disabled = disabled;
    this.q('.chat-task-retry').hidden = !waiting; this.q<HTMLButtonElement>('.chat-task-retry').disabled = this.controlling;
  }
  private render(detail: Task) {
    if (this.dead || this.selected !== detail.id) return;
    this.current = detail; this.panel.hidden = false;
    this.root.classList.add('chat-task-selected');
    this.root.classList.toggle('chat-task-only', !detail.conversationId || this.linkedConversation !== detail.conversationId);
    find(this.root, '.chat-toolbar h1').textContent = detail.title;
    find(this.root, '.chat-badge').textContent = statusText(detail);
    const signature = JSON.stringify(detail);
    if (signature !== this.signature) {
      overview(this.q('.chat-task-overview'), detail); this.artifacts(detail); this.signature = signature;
    }
    this.lock(); this.drawList();
  }
  private artifacts(detail: Task) {
    const box = this.q('.chat-task-artifacts'); box.replaceChildren();
    if (!detail.artifacts?.length) return;
    const heading = document.createElement('h3'); heading.textContent = '任务产物'; box.append(heading);
    for (const artifact of detail.artifacts) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = readable(artifact.title);
      button.onclick = () => void this.showArtifact(detail.id, artifact.ref); box.append(button);
    }
  }
  private async showArtifact(id: string, ref: string) {
    try {
      const artifact = await this.taskApi<{ title: string; body: string }>('task-view', { id, artifactRef: ref });
      if (this.dead || this.selected !== id) return;
      const box = this.q('.chat-task-artifact'); box.hidden = false; box.replaceChildren();
      const title = document.createElement('h3'), body = document.createElement('pre');
      title.textContent = readable(artifact.title); body.textContent = artifact.body; box.append(title, body);
    } catch (error) {
      log('task_artifact_failed', error);
      if (!this.dead && this.selected === id) this.q('.chat-task-notice').textContent = '产物暂时无法读取：' + message(error);
    }
  }
  private async linkConversation(detail: Task, token: number) {
    if (!detail.conversationId) return;
    try {
      await this.selectConversation(detail.conversationId, () => this.active(detail.id, token));
      if (!this.active(detail.id, token)) return;
      this.linkedConversation = detail.conversationId; this.render(detail);
    } catch (error) {
      log('task_conversation_failed', error);
      if (this.active(detail.id, token)) this.q('.chat-task-notice').textContent = '原对话暂时无法读取，任务进展和操作仍可使用：' + message(error);
    }
  }
  async select(id: string) {
    const token = ++this.generation; this.selected = id; this.current = undefined; this.linkedConversation = undefined;
    this.signature = ''; this.panel.hidden = false; this.root.classList.add('chat-task-selected', 'chat-task-only');
    this.q('.chat-task-overview').replaceChildren(); this.q('.chat-task-artifacts').replaceChildren();
    this.q('.chat-task-notice').textContent = '正在读取任务…'; this.q('.chat-task-artifact').hidden = true;
    this.q<HTMLTextAreaElement>('textarea').value = ''; this.lock();
    try {
      const detail = await this.taskApi<Task>('task-view', { id });
      if (!this.active(id, token)) return;
      const url = new URL(window.location.href); url.searchParams.set('task', id);
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      this.root.classList.remove('chat-drawer-open'); this.render(detail);
      this.q('.chat-task-notice').textContent = this.pending() ? '上次操作结果待核对，请核对原请求。' : '';
      await this.linkConversation(detail, token);
    } catch (error) {
      log('task_detail_failed', error);
      if (this.active(id, token)) this.q('.chat-task-notice').textContent = '任务暂时无法读取：' + message(error);
    }
  }
  async refresh() {
    if (!this.alive() || this.loading) return;
    this.loading = true; find<HTMLButtonElement>(this.sidebar, '.chat-tasks-refresh').disabled = true;
    try {
      const result = await this.taskApi<{ items: Task[] }>('task-view');
      if (!this.alive()) return;
      this.items = result.items; this.drawList(); this.notice.textContent = this.items.length ? '' : '暂无后台任务';
      if (this.selected) {
        const id = this.selected, token = this.generation, detail = await this.taskApi<Task>('task-view', { id });
        if (this.active(id, token)) this.render(detail);
      }
    } catch (error) {
      log('task_load_failed', error);
      if (this.alive()) { this.notice.textContent = '后台任务暂时无法加载：' + message(error); this.nav.replaceChildren(); }
    } finally {
      this.loading = false;
      if (this.alive()) find<HTMLButtonElement>(this.sidebar, '.chat-tasks-refresh').disabled = false;
    }
  }
  private prepare(operation: Operation | undefined) {
    const pending = this.pending(); if (pending) return pending;
    if (!operation || !this.current) return null;
    const text = this.q<HTMLTextAreaElement>('textarea').value.trim();
    if (operation === 'supplement' && !text) { this.q('.chat-task-notice').textContent = '请填写补充要求'; return null; }
    const input = JSON.stringify({ id: this.current.id, operation, expectedRevision: this.current.revision,
      expectedVisibilityRevision: this.current.visibilityRevision, actionKey: crypto.randomUUID(),
      ...(operation === 'supplement' ? { text, goal: this.current.details.goal } : {}) });
    localStorage.setItem(pendingKey(this.current.id), input); return input;
  }
  private controlFailed(error: unknown, id: string, token: number) {
    log('task_control_failed', error);
    if (definiteFailure(error)) localStorage.removeItem(pendingKey(id));
    if (!this.active(id, token)) return;
    const next = this.pending() ? '请核对原请求。' : '请刷新任务后重试。';
    this.q('.chat-task-notice').textContent = `操作未确认：${message(error)}。${next}`;
  }
  private async control(operation?: Operation) {
    if (!this.selected || !this.current || this.controlling) return;
    const id = this.selected, token = this.generation, input = this.prepare(operation);
    if (!input) return;
    this.controlling = true; this.lock();
    try {
      await this.taskApi('task-control', { input }); localStorage.removeItem(pendingKey(id));
      if (!this.active(id, token)) return;
      this.q<HTMLTextAreaElement>('textarea').value = '';
      this.q('.chat-task-notice').textContent = '已记录，后续进展会继续显示在这个任务中。'; await this.refresh();
    } catch (error) { this.controlFailed(error, id, token); }
    finally { this.controlling = false; if (!this.dead) this.lock(); }
  }
  close() {
    ++this.generation; this.selected = undefined; this.current = undefined; this.panel.hidden = true;
    this.root.classList.remove('chat-task-selected', 'chat-task-only'); this.drawList();
    const url = new URL(window.location.href); url.searchParams.delete('task');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash); this.onClose();
  }
  destroy() {
    this.dead = true; this.search.removeEventListener('input', this.drawList); this.sidebar.remove(); this.panel.remove();
  }
}
export function mountTasks(root: HTMLElement, api: Api, selectConversation: ConversationReader, onClose: () => void) {
  return new TaskWorkbench(root, api, selectConversation, onClose);
}
