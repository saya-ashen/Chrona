import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Drafts, DraftConflicts, Operations, uploadFiles } from './client-state';
import { targetKey, defaultTools } from './tool-selection';
export default function mount(element: HTMLElement, { call }: any) {
  const root = document.createElement('div'); root.className = 'chat-workbench'; element.append(root);
  root.innerHTML = `<aside class="chat-sidebar" aria-label="会话"><div class="chat-brand"><b>Chat</b><button data-action="drawer" class="chat-close" aria-label="关闭会话列表">×</button></div><button class="chat-new" data-action="new">＋ 新对话</button><button type="button" data-action="new-empty" hidden>新对话（关闭工具后手动选择）</button><input class="chat-search" type="search" placeholder="搜索会话" aria-label="搜索会话"><nav aria-label="会话列表"></nav><label class="chat-checkbox"><input class="chat-archive" type="checkbox">查看已归档</label></aside><div class="chat-main"><div class="chat-toolbar"><button class="chat-drawer" data-action="drawer" aria-label="打开会话列表">☰</button><h1>Chat</h1><span class="chat-badge">正在加载</span><details class="chat-more"><summary aria-label="更多会话操作">•••</summary><div><button data-action="rename">重命名</button><button data-action="pin">置顶</button><button data-action="archive">归档</button><button data-action="settings">工具与设置</button><button data-action="mind-scope">Mind 学习范围</button><button data-action="delivery">应用交付</button><button data-action="diagnostics">执行详情</button><button data-action="new-context">新执行上下文</button><button data-action="delete">删除会话</button></div></details></div><div class="chat-alert" role="status" hidden></div><div class="chat-alert chat-mind-context" role="status" hidden></div><div class="chat-mind-updates chat-alert" role="status" aria-atomic="true" hidden></div><div class="chat-messages" tabindex="0" aria-label="消息记录"></div><div class="chat-questions"></div><div class="chat-compose"><div class="chat-attachments"></div><textarea rows="2" aria-label="消息" placeholder="输入消息…" disabled></textarea><div class="chat-compose-bar"><label class="chat-upload" aria-label="添加图片">＋<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden disabled></label><select class="chat-model" aria-label="下一轮模型" disabled></select><select class="chat-thinking" aria-label="下一轮思考强度" disabled></select><button class="chat-tools-button" data-action="settings">工具</button><span class="chat-spacer"></span><button class="chat-stop" data-action="stop" hidden>停止</button><button class="chat-send" data-action="send" disabled>发送 ↑</button></div><div class="chat-compose-hint"></div></div></div><dialog class="chat-settings" aria-label="工具与设置"><h2 tabindex="-1" autofocus>工具与设置</h2><p>这里的更改用于下一轮，运行中的配置保留不变。</p><label class="chat-field">对话提供方<select class="chat-provider"></select></label><p class="chat-config-warning"></p><h3>应用工具</h3><p>新会话默认开启当前全部可委派应用工具。已有会话保留选择，新增工具需手动开启。内核每轮最多100个；超过时请手动选择。</p><button type="button" data-action="tools-all">全部开启</button><button type="button" data-action="tools-none">全部关闭</button><p class="chat-tool-notice" role="status"></p><input class="chat-tool-search" type="search" placeholder="搜索工具及用途" aria-label="搜索工具"><div class="chat-tools"></div><p class="chat-subtle">权限以内核为准。未选应用工具仍可能使用提供方自带的文件和 shell 能力。</p><form method="dialog"><button>完成</button></form></dialog><dialog class="chat-context-confirm" aria-label="新执行上下文"><h2>开始新执行上下文？</h2><p>保留 Chat 消息，后续执行不续接旧 Provider 上下文；不会重发未知请求。</p><form method="dialog"><button value="cancel" autofocus>取消</button><button value="create">开始</button></form></dialog><dialog class="chat-confirm" aria-label="删除会话"><h2>删除这段对话？</h2><p>只删除此 Chat 会话和附件，无法撤销。</p><form method="dialog"><button value="cancel" autofocus>取消</button><button value="delete">删除</button></form></dialog><dialog class="chat-rename" aria-label="重命名会话"><h2>重命名</h2><form method="dialog"><input name="title" aria-label="会话名称" maxlength="120" required autofocus><button value="cancel" formnovalidate>取消</button><button value="save">保存</button></form></dialog><dialog class="chat-delivery" aria-label="应用交付"><h2 tabindex="-1" autofocus>应用交付</h2><p>提交、批准、激活与浏览器验收分别核对。</p><div class="chat-delivery-items"></div><details><summary>按精确回执核对</summary><input class="chat-receipt" placeholder="receiptId" aria-label="精确回执ID"><button data-action="check-delivery">核对回执</button></details><form method="dialog"><button>关闭</button></form></dialog><dialog class="chat-diagnostics" aria-label="执行详情"><h2 tabindex="-1" autofocus>执行详情</h2><p class="chat-recovery-note"></p><button data-action="refresh">按原请求核对</button><details><summary>原始执行记录</summary><pre></pre></details><form method="dialog"><button>关闭</button></form></dialog>`;
  root.insertAdjacentHTML('beforeend', `<dialog class="chat-mind-scope" aria-label="Mind 学习范围"><h2 tabindex="-1" autofocus>Mind 学习范围</h2><p>开启后，Mind 只学习开启后新发送的内容，不会回溯旧消息，也不会读取草稿。关闭会撤回此前提供的会话内容；重新开启也只接收新发送的内容。</p><p>排除或设为私密会撤回这段会话此前提供的内容；恢复纳入后，也只接收之后新发送的内容。</p><p class="chat-scope-status" role="status"></p><form class="chat-scope-form"><label class="chat-checkbox"><input name="enabled" type="checkbox" disabled>允许 Mind 学习新发送的内容（所有会话）</label><fieldset class="chat-scope-conversation" disabled><legend>当前会话</legend><p class="chat-scope-title"></p><label class="chat-checkbox"><input name="excluded" type="checkbox">排除这段会话</label><label class="chat-checkbox"><input name="private" type="checkbox">将这段会话设为私密</label></fieldset><button type="submit" disabled>保存学习范围</button></form><button type="button" data-action="scope-refresh">重新读取范围</button><form method="dialog"><button>关闭</button></form></dialog>`);
  const $ = (selector: string) => root.querySelector(selector) as any;
  const text = $('textarea'), messages = $('.chat-messages');
  const drafts = new Drafts(localStorage), operations = new Operations(localStorage);
  let c: any = null, catalog: any = { providers: [], configs: {}, tools: [] }, list: any[] = [];
  let dead = false, ready = false, busy = false, polling = false, renderSignature = '', drawer = false, creating = false;
  let saveQueue: Promise<any> = Promise.resolve(), saveTimer: any, selectionGeneration = 0;
  let mindScope: any = null, scopeConversationId: string | undefined, scopeBusy = false, scopeGeneration = 0;
  const conflicts = new DraftConflicts(localStorage);
  const conflictMessage = '未保存更改待核对；请在更多操作中选择“核对未保存更改”，再决定是否重试。';
  const reviewButton = document.createElement('button'); reviewButton.type = 'button'; reviewButton.hidden = true; reviewButton.dataset.action = 'review-draft'; reviewButton.textContent = '核对未保存更改'; $('.chat-more div').append(reviewButton);
  const api = async (name: string, args: any = {}) => {
    const result = await call(name, args);
    if (dead) throw Error('组件已卸载');
    return JSON.parse(result.json);
  };
  function alert(message = '') { if (!dead) { $('.chat-alert').textContent = message; $('.chat-alert').hidden = !message; } }
  function fail(e: any) { alert((conflicts.read(c?.id) ? conflictMessage + '\n' : '') + (e.message ?? String(e))); }
  const task = (fn: () => Promise<any>) => fn().catch(fail);
  function height() { root.style.height = Math.max(280, (window.visualViewport?.height ?? innerHeight) - root.getBoundingClientRect().top) + 'px'; }
  window.addEventListener('resize', height); window.visualViewport?.addEventListener('resize', height); height();
  function lock() {
    root.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(b => b.disabled = !ready);
    lockScope();
    text.disabled = !ready || !c; $('.chat-upload input').disabled = !ready || !c;
    if (ready && !c) {
      root.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(b => b.disabled = !['new','new-empty','drawer','mind-scope','scope-refresh'].includes(b.dataset.action!));
      lockScope();
      $('.chat-badge').textContent = '选择或新建对话'; return;
    }
    if (!ready || !c) return;
    reviewButton.hidden = !conflicts.read(c.id);
    const hasProvider = catalog.providers.some((p: any) => p.id === c.settings.providerId && p.available);
    const pending = operations.read(c.id) || c.operations.some((o: any) => !['succeeded', 'failed', 'rejected'].includes(o.status));
    $('.chat-send').disabled = navigator.onLine === false || !!conflicts.read(c.id) || busy || (!text.value.trim() && !c.attachments.length) || !hasProvider || !!pending || (!!c.active && !c.active.runId) || !!c.active?.ended || !!c.active?.stopRequested;
    $('.chat-send').textContent = c.active ? '补充 ↑' : '发送 ↑';
    $('.chat-stop').hidden = !c.active?.runId;
    $('.chat-stop').disabled = busy || (!!pending && !c.active?.stopRequested && operations.read(c.id)?.kind !== 'stop');
    $('.chat-stop').textContent = c.active?.stopRequested ? '核对停止' : '停止';
    root.querySelectorAll<HTMLInputElement>('.chat-questions button,.chat-questions input,.chat-questions select,.chat-questions textarea').forEach(b => b.disabled = busy || !!pending || !!c.active?.ended);
    $('.chat-model').disabled = !ready; $('.chat-thinking').disabled = !ready;
    $('[data-action="delete"]').disabled = !!c.active || !!pending;
    $('.chat-badge').textContent = c.active ? (c.active.stopRequested ? (c.active.ended ? '已结束 · 停止未知' : '停止待确认') : c.active.ended ? '读取记录' : '执行中') : hasProvider ? '可开始对话' : '请选择提供方';
    $('.chat-compose-hint').textContent = navigator.onLine === false ? '当前离线 · 草稿保留在本机，联网后核对保存再发送' : pending ? '请求待确认 · 在执行详情中核对原请求' : c.active ? '可继续输入补充指令 · 模型设置用于下一轮' : hasProvider ? 'Ctrl / ⌘ + Enter 发送' : '在工具与设置中选择可用的对话提供方';
  }
  function adopt(id: string, next: any) {
    operations.settle(id, next, drafts);
    if (c?.id !== id) return;
    if (next.revision < c.revision || (c.updatedAt && next.updatedAt && next.updatedAt < c.updatedAt)) return;
    c = next; text.value = drafts.value(id, next.draft); draw();
  }
  async function flush() {
    if (!c) return;
    const id = c.id, local = drafts.read(id);
    if (!local) { await saveQueue; if (conflicts.read(id)) throw Error(conflictMessage); return; }
    const run = saveQueue.then(async () => {
      if (c?.id !== id) return;
      if (conflicts.read(id)) throw Error(conflictMessage);
      try {
        const result = await api('draft', { id, revision: c.revision, patch: JSON.stringify({ draft: local.text }) });
        // Only the exact saved local version may be removed. New typing remains recoverable.
        drafts.clear(id, local.token); adopt(id, result); return result;
      } catch (e) { if (!conflicts.read(id)) conflicts.edit(id, {}); lock(); throw e; }
    });
    saveQueue = run.then(() => undefined, () => undefined); return run;
  }
  async function saveSettings() {
    if (!c) return;
    const id = c.id, settings = structuredClone(c.settings);
    if (conflicts.read(id)) { conflicts.edit(id, { settings }); lock(); throw Error(conflictMessage); }
    const run = saveQueue.then(async () => {
      if (c?.id !== id) return;
      if (conflicts.read(id)) { conflicts.edit(id, { settings }); throw Error(conflictMessage); }
      try {
        const result = await api('draft', { id, revision: c.revision, patch: JSON.stringify({ settings }) });
        adopt(id, result);
      } catch (e) { conflicts.edit(id, { settings }); lock(); throw e; }
    });
    saveQueue = run.then(() => undefined, () => undefined); return run;
  }
  text.addEventListener('input', () => {
    if (!c) return;
    drafts.edit(c.id, text.value); lock(); clearTimeout(saveTimer);
    saveTimer = setTimeout(() => task(flush), 350);
  });
  function drawList() {
    const q = $('.chat-search').value.toLocaleLowerCase(), archived = $('.chat-archive').checked;
    $('nav').replaceChildren();
    for (const item of list.filter(x => !!x.archived === archived && x.title.toLocaleLowerCase().includes(q))) {
      const b = document.createElement('button'); b.textContent = (item.pinned ? '◆ ' : '') + item.title;
      b.className = item.id === c?.id ? 'chat-selected' : ''; b.setAttribute('aria-current', item.id === c?.id ? 'page' : 'false');
      b.onclick = () => task(() => select(item.id)); $('nav').append(b);
    }
  }
  async function refreshList() { list = (await api('list')).items; drawList(); }
  async function createConversation(emptyTools = false) {
    if (creating) return;
    const route = new URL(window.location.href);
    const prior = route.searchParams.get('createKey');
    if (!prior && !emptyTools && catalog.tools.filter((t: any) => t.available !== false).length > (catalog.toolLimit ?? 100)) throw Error('可委派工具超过100个，请点击“新对话（关闭工具后手动选择）”。');
    const requestKey = prior || crypto.randomUUID();
    const empty = prior ? route.searchParams.get('createEmpty') === '1' : emptyTools;
    // Persist intent before the first await. Unmount and lost replies retain this exact request.
    route.searchParams.set('new', '1'); route.searchParams.set('createKey', requestKey); route.searchParams.set('createEmpty', empty ? '1' : '0');
    window.history.replaceState(window.history.state, '', route.pathname + route.search + route.hash);
    creating = true;
    try {
      await flush();
      const created = await api('create', {requestKey, emptyTools: empty});
      const current = new URL(window.location.href);
      if (current.searchParams.get('createKey') !== requestKey) return;
      current.searchParams.delete('new'); current.searchParams.delete('createKey'); current.searchParams.delete('createEmpty'); current.searchParams.set('conversation', created.id);
      window.history.replaceState(window.history.state, '', current.pathname + current.search + current.hash);
      await select(created.id); await refreshList(); text.focus();
    } finally { creating = false; }
  }
  async function select(id: string) {
    const generation = ++selectionGeneration;
    try { await flush(); } catch (e) { fail(e); } // Recovery reads must bypass failed saves.
    if (generation !== selectionGeneration) return;
    const next = await api('read', { id });
    if (generation !== selectionGeneration) return;
    if (c?.id === id) adopt(id, next);
    else { c = next; operations.settle(id, next, drafts); text.value = drafts.value(id, next.draft); }
    const route = new URL(window.location.href); route.searchParams.set('conversation', id);
    window.history.replaceState(window.history.state, '', route.pathname + route.search + route.hash);
    drawer = false; root.classList.remove('chat-drawer-open'); renderSignature = ''; draw(); configOptions(); drawList();
  }
  async function reviewDraft() {
    if (!c || !conflicts.read(c.id)) return;
    const id = c.id;
    await saveQueue;
    const next = await api('read', { id });
    if (c?.id !== id) return;
    adopt(id, next); configOptions();
    const proposal = conflicts.read(id)!, local = drafts.read(id);
    const dialog = document.createElement('dialog'); dialog.className = 'chat-draft-review'; dialog.setAttribute('aria-label', '核对未保存更改');
    const title = document.createElement('h2'); title.textContent = '核对后重试保存';
    const note = document.createElement('p'); note.textContent = '请比较服务器当前值和本地未保存内容。重试将保存下列本地内容；取消会继续保留，发送仍暂停。';
    const pre = document.createElement('pre'); pre.textContent = JSON.stringify({ 服务器: { revision: next.revision, draft: next.draft, settings: next.settings }, 本地未保存: { draft: local?.text, settings: proposal.settings } }, null, 2);
    const form = document.createElement('form'); form.method = 'dialog';
    const cancel = document.createElement('button'); cancel.value = 'cancel'; cancel.textContent = '取消';
    const retry = document.createElement('button'); retry.value = 'retry'; retry.textContent = '已核对，重试本地更改'; form.append(cancel, retry); dialog.append(title, note, pre, form); root.append(dialog);
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'retry'; dialog.remove();
      if (!confirmed || dead) return;
      task(async () => {
        const run = saveQueue.then(async () => {
          const patch = { ...(local ? { draft: local.text } : {}), ...(proposal.settings ? { settings: proposal.settings } : {}) };
          const result = await api('draft', { id, revision: next.revision, patch: JSON.stringify(patch) });
          if (local) drafts.clear(id, local.token);
          conflicts.clear(id, proposal.token);
          adopt(id, result); configOptions();
        });
        saveQueue = run.then(() => undefined, () => undefined); await run;
      });
    }, { once: true }); dialog.showModal(); cancel.focus();
  }
  function markdown(value: string) {
    const div = document.createElement('div'); div.className = 'chat-markdown';
    div.innerHTML = DOMPurify.sanitize(marked.parse(value, { async: false }) as string, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'input', 'form', 'button', 'video', 'audio', 'iframe'], FORBID_ATTR: ['style'] });
    div.querySelectorAll('a').forEach(a => { a.rel = 'noopener noreferrer'; a.target = '_blank'; });
    div.querySelectorAll('pre').forEach(pre => {
      const button = document.createElement('button'); button.textContent = '复制代码';
      button.onclick = () => task(async () => { await navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? ''); button.textContent = '已复制'; }); pre.prepend(button);
    }); return div;
  }
  function runView(run: any) {
    const box = document.createElement('div');
    for (const gap of run.gaps ?? []) { const p = document.createElement('p'); p.className = 'chat-gap'; p.textContent = gap.message; box.append(p); }
    if (run.transcript?.length) for (const item of run.transcript) {
      if (item.kind === 'text') box.append(markdown(item.text));
      else { const d = document.createElement('details'), s = document.createElement('summary'), pre = document.createElement('pre'); s.textContent = (item.kind === 'tool' ? '调用 ' : '结果 ') + (item.tool ?? '工具') + (item.error ? ' · 失败' : ''); pre.textContent = item.text ?? item.args ?? ''; d.append(s, pre); box.append(d); }
    } else for (const item of run.events ?? []) if (item.kind === 'text' || item.kind === 'completion') box.append(markdown(item.payload?.text ?? ''));
    return box;
  }
  function attachment(a: any, removable: boolean) {
    const b = document.createElement('button'); b.textContent = a.name + (removable ? ' ×' : '');
    const origin = c.id;
    const pinned = c.operations.some((o: any) => !['succeeded', 'rejected', 'failed'].includes(o.status) && o.snapshot?.attachments?.some((x: any) => x.id === a.id));
    if (removable && pinned) { b.disabled = true; b.title = '未确认的发送仍引用此图片'; }
    b.onclick = () => task(async () => {
      if (removable) { await flush(); adopt(origin, await api('detach', { id: origin, attachmentId: a.id })); }
      else {
        const image = await api('image', { id: origin, attachmentId: a.id });
        const dialog = document.createElement('dialog'); dialog.className = 'chat-image'; dialog.setAttribute('aria-label', a.name);
        const img = document.createElement('img'); img.alt = a.name; img.src = 'data:' + image.mime + ';base64,' + image.base64;
        const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => dialog.close(); dialog.append(img, close); root.append(dialog);
        dialog.addEventListener('close', () => { img.src = ''; dialog.remove(); }, { once: true }); dialog.showModal();
      }
    }); return b;
  }
  function draw() {
    if (!c) { lock(); return; }
    $('.chat-toolbar h1').textContent = c.title;
    $('.chat-mind-context').textContent = c.mindContextStatus ? String(c.mindContextStatus) : '';
    $('.chat-mind-context').hidden = !c.mindContextStatus;
    const updates = $('.chat-mind-updates');
    const progress = (c.mindUpdates ?? []).map((u: any) => `Mind · ${({waiting:'等待处理',active:'正在继续',candidate:'待核对',done:'已核对完成',paused:'已暂停'} as any)[u.status] ?? '跟进中'}：${u.goal}${u.waitReason ? `；阻塞：${u.waitReason}` : ''}${u.nextStep ? `；下一步：${u.nextStep}` : ''}`).join('\n');
    if (updates.textContent !== progress) updates.textContent = progress;
    updates.hidden = !progress;
    $('[data-action="pin"]').textContent = c.pinned ? '取消置顶' : '置顶'; $('[data-action="archive"]').textContent = c.archived ? '取消归档' : '归档';
    const signature = JSON.stringify([c.messages, c.active?.transcript, c.active?.events, c.active?.gaps]);
    if (signature !== renderSignature) {
      const follow = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100, scroll = messages.scrollTop;
      messages.replaceChildren();
      if (!c.messages.length && !c.active) {
        const div = document.createElement('div'); div.className = 'chat-empty'; const h = document.createElement('h2'), p = document.createElement('p');
        h.textContent = '今天想做些什么？'; p.textContent = '聊个想法，或选择应用工具一起办事。'; div.append(h, p); messages.append(div);
      }
      for (const m of c.messages) {
        const article = document.createElement('article'); article.className = 'chat-message chat-' + m.role;
        const label = document.createElement('div'); label.className = 'chat-message-label'; label.textContent = m.role === 'user' ? '你' : 'Chrona'; article.append(label);
        article.append(m.run ? runView(m.run) : markdown(m.text)); for (const a of m.attachments ?? []) article.append(attachment(a, false)); messages.append(article);
      }
      if (c.active) { const article = document.createElement('article'); article.className = 'chat-message chat-assistant'; article.append(runView(c.active)); messages.append(article); }
      messages.scrollTop = follow ? messages.scrollHeight : scroll; renderSignature = signature;
    }
    $('.chat-attachments').replaceChildren(...c.attachments.map((a: any) => attachment(a, true)));
    const questions = $('.chat-questions'), qsig = JSON.stringify(c.active?.interactions ?? []);
    if (questions.dataset.signature !== qsig) {
      questions.dataset.signature = qsig; questions.replaceChildren();
      for (const q of c.active?.interactions ?? []) if (q.status === 'pending') {
        const form = document.createElement('form'), label = document.createElement('label'); label.textContent = q.question.title + ' ' + q.question.message;
        let field: any;
        if (['select', 'confirm'].includes(q.question.method)) {
          field = document.createElement('select'); const options = q.question.method === 'confirm' ? ['确认', '否'] : q.question.options;
          options.forEach((value: string, i: number) => { const option = document.createElement('option'); option.value = String(i); option.textContent = value; field.append(option); });
        } else { field = document.createElement(q.question.method === 'editor' ? 'textarea' : 'input'); field.value = q.question.prefill ?? ''; }
        const send = document.createElement('button'); send.textContent = '回答';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消交互';
        cancel.onclick = () => task(() => execute('answer', { questionId: q.id, answer: { decision: 'cancel' } }));
        label.append(field); form.append(label, send, cancel);
        form.onsubmit = e => { e.preventDefault(); let value: any = field.value; if (q.question.method === 'select') value = Number(value); if (q.question.method === 'confirm') value = value === '0'; task(() => execute('answer', { questionId: q.id, answer: { decision: 'submit', value } })); }; questions.append(form);
      }
    }
    lock();
    const original = c.operations.find((o: any) => o.recoveryNotice)?.recoveryNotice;
    const latest = c.operations.at(-1);
    const latestError = latest && !['succeeded'].includes(latest.status) ? latest.error : null;
    alert(conflicts.read(c.id) ? conflictMessage : original ?? c.active?.error ?? latestError ?? '');
    if (c.active?.stopRequested && c.active.ended && !c.active.stopConfirmed) $('.chat-compose-hint').textContent = '任务观测已结束；停止命令仍未确认，继续保留占用';
  }
  async function execute(kind: string, input: any = {}) {
    if (!c || busy) return;
    if (conflicts.read(c.id) && ['send', 'message', 'answer'].includes(kind)) throw Error(conflictMessage);
    const id = c.id;
    // Capture identity and draft before any await, including saving the draft.
    const token = drafts.read(id)?.token ?? null, snapshotText = text.value, origin = structuredClone(c);
    busy = true; lock();
    try {
      const saved = kind === 'stop' && conflicts.read(id) ? undefined : await flush();
      const original = operations.read(id);
      const args = original ? null : kind === 'send' ? { snapshot: { draft: snapshotText, revision: saved?.revision ?? origin.revision, attachmentIds: origin.attachments.map((a: any) => a.id), settings: origin.settings } } : { ...input, runId: origin.active?.runId, ...(kind === 'message' ? { draftSnapshot: { draft: snapshotText, revision: saved?.revision ?? origin.revision } } : {}) };
      const op = original ?? operations.begin(id, kind, args, token);
      const result = await api('execute', { id, key: op.key, kind: op.kind, input: op.input });
      adopt(id, result); await refreshList();
    } finally { busy = false; lock(); }
  }
  function configOptions() {
    if (!c) return;
    const cfg = catalog.configs[c.settings.providerId] ?? {};
    const models = cfg.models?.length ? cfg.models : [{ value: '', label: '继承提供方模型' }];
    for (const [selector, values, current] of [ ['.chat-model', models, c.settings.model], ['.chat-thinking', [{ value: '', label: '思考：默认' }, ...(cfg.thinking ?? []).filter(Boolean).map((value: string) => ({ value, label: '思考：' + value }))], c.settings.thinking] ] as any) {
      const select = $(selector); select.replaceChildren(); for (const value of values) { const option = document.createElement('option'); option.value = value.value; option.textContent = value.label; select.append(option); } select.value = current;
    }
    $('.chat-config-warning').textContent = cfg.warning ?? '';
  }
  function open(dialog: any) { dialog.showModal(); const title = dialog.querySelector('h2[tabindex]'); if (title) title.focus({ preventScroll: true }); dialog.scrollTop = 0; }
  function lockScope() {
    const loaded = !!mindScope && !scopeBusy;
    $('.chat-scope-form [name="enabled"]').disabled = !loaded;
    $('.chat-scope-conversation').disabled = !loaded || !scopeConversationId;
    $('.chat-scope-form button[type="submit"]').disabled = !loaded;
    $('[data-action="scope-refresh"]').disabled = scopeBusy;
  }
  function showScope(next: any) {
    if (!Number.isSafeInteger(next?.revision) || next.revision < 0 || typeof next.enabled !== 'boolean' ||
        (scopeConversationId && (next.conversation?.id !== scopeConversationId || typeof next.conversation.excluded !== 'boolean' || typeof next.conversation.private !== 'boolean'))) throw Error('invalid_scope_response');
    mindScope = next;
    $('.chat-scope-form [name="enabled"]').checked = next.enabled;
    for (const name of ['excluded', 'private']) $('.chat-scope-form [name="' + name + '"]').checked = next.conversation?.[name] ?? false;
    $('.chat-scope-status').textContent = next.enabled ? '学习已开启；仅纳入开启后新发送且未排除、非私密会话的内容。' : '学习已关闭，已撤回此前提供的会话内容。';
  }
  async function readScope() {
    if (scopeBusy) return;
    const generation = ++scopeGeneration, conversationId = scopeConversationId;
    mindScope = null; scopeBusy = true; lockScope(); $('.chat-scope-status').textContent = '正在读取学习范围…';
    try {
      const next = await api('observation-scope', conversationId ? { conversationId } : {});
      if (!dead && generation === scopeGeneration) showScope(next);
    } catch {
      console.error(JSON.stringify({ component: 'chat', event: 'observation_scope_read', error: 'read_or_validation_failed' }));
      if (!dead && generation === scopeGeneration) $('.chat-scope-status').textContent = '学习范围读取失败，请重新读取后再修改。';
    } finally { if (!dead && generation === scopeGeneration) { scopeBusy = false; lockScope(); } }
  }
  $('.chat-scope-form').addEventListener('submit', (e: Event) => {
    e.preventDefault(); if (!mindScope || scopeBusy) return;
    const generation = scopeGeneration;
    const input = { expectedRevision: mindScope.revision, enabled: $('.chat-scope-form [name="enabled"]').checked,
      ...(scopeConversationId ? { conversationId: scopeConversationId, excluded: $('.chat-scope-form [name="excluded"]').checked, private: $('.chat-scope-form [name="private"]').checked } : {}) };
    scopeBusy = true; lockScope(); $('.chat-scope-status').textContent = '正在保存学习范围…';
    task(async () => {
      try {
        const next = await api('observation-scope', input);
        if (!dead && generation === scopeGeneration) { showScope(next); $('.chat-scope-status').textContent = '已保存。' + $('.chat-scope-status').textContent; }
      } catch {
        console.error(JSON.stringify({ component: 'chat', event: 'observation_scope_save', error: 'save_or_revision_check_failed' }));
        if (!dead && generation === scopeGeneration) { mindScope = null; $('.chat-scope-status').textContent = '未确认保存成功，范围可能已在别处修改。请重新读取、核对后再保存。'; }
      } finally { if (!dead && generation === scopeGeneration) { scopeBusy = false; lockScope(); } }
    });
  });
  function tools() {
    const box = $('.chat-tools'), query = $('.chat-tool-search').value.toLocaleLowerCase(); box.replaceChildren(); const groups = new Map<string, any[]>();
    const missing = c.settings.tools.filter((t: any) => !catalog.tools.some((x: any) => targetKey(x.target) === targetKey(t)));
    $('.chat-tool-notice').textContent = missing.length ? `${missing.length} 个已选工具已移除或不可用，选择仍保留；恢复可用后可继续使用，也可全部关闭后重选。` : `已选 ${c.settings.tools.length} / ${catalog.tools.length} 个应用工具`;
    for (const t of catalog.tools) { const label = typeof t.target === 'string' ? t.target : t.module + '.' + t.target.tool; if (!(label + ' ' + t.description).toLocaleLowerCase().includes(query)) continue; if (!groups.has(t.module)) groups.set(t.module, []); groups.get(t.module)!.push({ ...t, label }); }
    for (const [group, items] of groups) {
      const d = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = group; d.open = !!query; d.append(summary);
      for (const t of items) { const label = document.createElement('label'), input = document.createElement('input'); label.className = 'chat-checkbox'; input.type = 'checkbox'; input.checked = c.settings.tools.some((x: any) => targetKey(x) === targetKey(t.target)); input.disabled = t.available === false; input.onchange = () => task(async () => { c.settings.tools = c.settings.tools.filter((x: any) => targetKey(x) !== targetKey(t.target)); if (input.checked) { if (c.settings.tools.length >= (catalog.toolLimit ?? 100)) { input.checked = false; throw Error('内核每轮最多100个工具，请先关闭其他工具后再选择。'); } c.settings.tools.push(t.target); } await saveSettings(); }); label.append(input, document.createTextNode(t.label + ' — ' + t.description + (input.disabled ? ' · ' + (t.reason ?? '不可用') : ''))); d.append(label); } box.append(d);
    }
  }
  function settings() {
    const select = $('.chat-provider'); select.replaceChildren(); const empty = document.createElement('option'); empty.value = ''; empty.textContent = '选择对话提供方'; select.append(empty);
    for (const p of catalog.providers) { const option = document.createElement('option'); option.value = p.id; option.textContent = p.name + (p.available ? '' : '（不可用）'); option.disabled = !p.available; select.append(option); }
    select.value = c.settings.providerId; tools(); open($('.chat-settings'));
  }
  function delivery() {
    const box = $('.chat-delivery-items'); box.replaceChildren();
    if (!c.deliveries.length) box.textContent = '这段对话还没有已确认的应用提交回执。';
    for (const d of c.deliveries) {
      const card = document.createElement('div'); card.className = 'chat-delivery-card'; const h = document.createElement('h3'); h.textContent = d.state; card.append(h);
      for (const m of d.members ?? d.original?.members ?? []) { const p = document.createElement('p'); p.textContent = (m.name ?? '应用') + ' · ' + (m.activation ?? '候选已提交') + ' · 浏览器验收待核实'; card.append(p); }
      if (d.approvalId) { const p = document.createElement('p'); p.textContent = '安装审批：' + d.approvalId; card.append(p); }
      if (d.error) { const p = document.createElement('p'); p.textContent = d.error; card.append(p); }
      const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre'); summary.textContent = '回执证据'; pre.textContent = JSON.stringify(d, null, 2); details.append(summary, pre); card.append(details); box.append(card);
    }
  }
  async function refresh(observe = false) {
    if (!c) return; const id = c.id;
    if (observe) { adopt(id, await api('read', { id, observe: true })); return; }
    try { await flush(); } catch (e) { fail(e); }
    if (conflicts.read(id)) { adopt(id, await api('read', { id })); configOptions(); return; }
    const pending = operations.read(id);
    if (pending) adopt(id, await api('execute', { id, key: pending.key, kind: pending.kind, input: pending.input }));
    else adopt(id, await api('read', { id }));
  }
  root.addEventListener('click', e => {
    const action = (e.target as Element).closest('[data-action]')?.getAttribute('data-action'); if (!action || !ready) return;
    if (action !== 'drawer') $('.chat-more').open = false;
    task(async () => {
      switch (action) {
        case 'tools-all': c.settings.tools = defaultTools(catalog.tools); await saveSettings(); tools(); break;
        case 'tools-none': c.settings.tools = []; await saveSettings(); tools(); break;
        case 'new': case 'new-empty': await createConversation(action === 'new-empty'); break;
        case 'drawer': drawer = !drawer; root.classList.toggle('chat-drawer-open', drawer); if (drawer) $('.chat-search').focus(); break;
        case 'send': await execute(c.active ? 'message' : 'send', { text: text.value }); break;
        case 'stop': await execute('stop'); break;
        case 'settings': settings(); break;
        case 'mind-scope':
          if (scopeBusy) break;
          scopeConversationId = c?.id; $('.chat-scope-title').textContent = c?.title ?? '未选择会话，仅修改全局范围';
          open($('.chat-mind-scope')); await readScope(); break;
        case 'scope-refresh': await readScope(); break;
        case 'review-draft': await reviewDraft(); break;
        case 'refresh': await refresh(); $('.chat-diagnostics pre').textContent = JSON.stringify({ active: c.active, operations: c.operations }, null, 2); break;
        case 'rename': $('.chat-rename input').value = c.title; open($('.chat-rename')); break;
        case 'pin': case 'archive': const id = c.id; adopt(id, await api('edit', { id, patch: JSON.stringify(action === 'pin' ? { pinned: !c.pinned } : { archived: !c.archived }) })); await refreshList(); break;
        case 'delete': open($('.chat-confirm')); break;
        case 'new-context': open($('.chat-context-confirm')); break;
        case 'delivery': delivery(); open($('.chat-delivery')); break;
        case 'check-delivery': adopt(c.id, await api('delivery', { id: c.id, receiptId: $('.chat-receipt').value })); delivery(); break;
        case 'diagnostics': $('.chat-recovery-note').textContent = (c.operations.find((o: any) => o.recoveryNotice)?.recoveryNotice ?? '核对使用原请求 key，不创建替代任务。') + (c.active ? ' 当前 Run 观测：' + (c.active.observedStatus ?? '未知') + '；停止命令：' + (c.active.stopRequested ? c.active.stopConfirmed ? '已确认' : '未确认，继续保留占用' : '未请求') : ''); $('.chat-diagnostics pre').textContent = JSON.stringify({ active: c.active, operations: c.operations }, null, 2); open($('.chat-diagnostics')); break;
      }
    });
  });
  $('.chat-context-confirm').addEventListener('close', () => { const d=$('.chat-context-confirm'), value=d.returnValue; d.returnValue=''; if(value==='create') task(async()=>{const id=c.id;adopt(id,await api('new-context',{id,confirmed:true}));alert('已开始新执行上下文，Chat 消息保留');}); });
  $('.chat-confirm').addEventListener('close', () => { const value = $('.chat-confirm').returnValue; $('.chat-confirm').returnValue = ''; if (value === 'delete') task(async () => { const id = c.id; await api('delete', { id, confirmed: true }); drafts.clear(id, drafts.read(id)?.token); c = null; await refreshList(); if (list[0]) await select(list[0].id); else await createConversation(); }); });
  $('.chat-rename').addEventListener('close', () => { const value = $('.chat-rename').returnValue; $('.chat-rename').returnValue = ''; if (value === 'save') task(async () => { const id = c.id; adopt(id, await api('edit', { id, patch: JSON.stringify({ title: $('.chat-rename input').value.trim() }) })); await refreshList(); }); });
  $('.chat-search').oninput = drawList; $('.chat-archive').onchange = drawList; $('.chat-tool-search').oninput = tools;
  for (const [selector, name] of [['.chat-model', 'model'], ['.chat-thinking', 'thinking'], ['.chat-provider', 'providerId']]) $(selector).onchange = () => task(async () => { c.settings[name] = $(selector).value; if (name === 'providerId') { c.settings.model = ''; c.settings.thinking = ''; } await saveSettings(); configOptions(); });
  $('.chat-upload input').onchange = () => {
    if (!c) return; const input = $('.chat-upload input'), origin = c.id, files = [...input.files]; input.value = '';
    task(async () => { await flush(); await uploadFiles(origin, files, args => api('upload', args), adopt); });
  };
  text.onkeydown = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); $('.chat-send').click(); } };
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && drawer) { drawer = false; root.classList.remove('chat-drawer-open'); $('.chat-drawer').focus(); } });
  const interval = setInterval(() => { if (dead || !ready || !c || polling || busy || document.hidden) return; polling = true; task(() => refresh(true)).finally(() => { polling = false; }); }, 2000);
  const offline = () => lock();
  const reconnect = () => { lock(); task(refresh); }; window.addEventListener('online', reconnect); window.addEventListener('offline', offline);
  lock();
  task(async () => {
    catalog = await api('catalog'); await refreshList();
    const availableCount = catalog.tools.filter((t: any) => t.available !== false).length;
    $('[data-action="new-empty"]').hidden = availableCount <= (catalog.toolLimit ?? 100);
    const url = new URL(window.location.href);
    if (url.searchParams.get('new') === '1') {
      if (!url.searchParams.has('createKey') && availableCount > (catalog.toolLimit ?? 100)) {
        ready = true; lock(); throw Error(`已发现 ${availableCount} 个可委派工具，内核每轮最多100个。请点击“新对话（关闭工具后手动选择）”，再选择最多100个工具。`);
      }
      try { await createConversation(); }
      finally { if (!dead) { ready = true; lock(); } }
    } else {
      const selected = list.find(x => x.id === url.searchParams.get('conversation')) ?? list.find(x => !x.archived);
      if (selected) await select(selected.id);
      else messages.textContent = '点击“新对话”开始。';
    }
    ready = true; lock();
  });
  return () => { dead = true; clearInterval(interval); clearTimeout(saveTimer); window.removeEventListener('resize', height); window.visualViewport?.removeEventListener('resize', height); window.removeEventListener('online', reconnect); window.removeEventListener('offline', offline); root.querySelectorAll('dialog').forEach(d => d.close()); root.remove(); };
}
