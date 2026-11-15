import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { MindContext } from './workspace-ui';

const window = new Window({ url: 'http://localhost/mind-ui-test' });
const previous = new Map<string, PropertyDescriptor | undefined>();
let mount: typeof import('./workspace-ui').default;
let lifecycle: ReturnType<typeof mount> | undefined;
let container: HTMLElement;
const logs: string[] = [];
const originalError = console.error;
const envelope = (value: unknown) => ({ json: JSON.stringify(value) });
const settings = { revision: 3, enabled: true, learningEnabled: true, notifyEnabled: false, autoSubmit: false, timezone: 'UTC', quietStart: '22:00', quietEnd: '08:00', restoreBlocked: false };
const pursuit = { id: 'p-1', revision: 4, goal: '整理研究资料', status: 'active', paused: false, scope: { projectId: 'research' }, evidenceRefs: [], artifactRefs: [], nextStep: '核对来源' };
const overview = (items: unknown[] = []) => ({ visibilityRevision: 7, items, settings });
async function wait(condition: () => boolean, reason = 'DOM condition') {
  for (let i = 0; i < 240; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error(`Timeout: ${reason}; visible=${container?.textContent}`);
}
const visible = () => container.textContent ?? '';
const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
const button = (name: string) => { const value = buttons().find(b => b.textContent?.trim() === name || b.getAttribute('aria-label') === name); if (!value) throw Error('Missing button: ' + name); return value; };
async function click(name: string) { button(name).click(); await new Promise(resolve => setTimeout(resolve, 8)); }
function fill(selector: string, value: string) {
  const element = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }) as any);
}
async function start(call: MindContext['call'], props?: MindContext['props']) {
  container = window.document.createElement('div') as any; window.document.body.append(container as any);
  lifecycle = mount(container, { call, props });
  await wait(() => !!container.querySelector('.mind-workspace'));
}
beforeAll(async () => {
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'navigator', 'Event', 'MouseEvent', 'KeyboardEvent']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? window : (window as any)[key] });
  }
  console.error = (...args) => { logs.push(args.map(String).join(' ')); };
  mount = (await import('./workspace-ui')).default;
});
afterEach(() => { lifecycle?.destroy(); lifecycle = undefined; window.document.body.replaceChildren(); });
afterAll(async () => {
  // React schedules passive cleanup through its own scheduler, outside Happy DOM.
  await new Promise(resolve => setTimeout(resolve, 25));
  await window.happyDOM.abort();
  console.error = originalError;
  for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
});

test('loading, empty, refresh recovery and scoped props are visible without fake records', async () => {
  let release!: (value: unknown) => void; const calls: any[] = [];
  const call = async (tool: string, args: any) => { calls.push({ tool, args }); return await new Promise(resolve => { release = resolve; }); };
  await start(call);
  expect(visible()).toContain('正在读取 Mind'); expect(button('交给 Mind').disabled).toBe(true);
  await wait(() => calls.length === 1);
  expect(calls).toEqual([{ tool: 'overview', args: {} }]);
  release(envelope(overview())); await wait(() => visible().includes('还没有正在推进的改进'));
  expect(visible()).toContain('查看当前接入范围'); expect(visible()).not.toContain('费用：0');
  lifecycle!.update({ call, props: { title: '我的 Mind', view: 'settings' } });
  await wait(() => visible().includes('我的 Mind') && !!container.querySelector('.mind-source-settings summary')); container.querySelector<HTMLElement>('.mind-source-settings summary')!.click(); await wait(()=>visible().includes('来源覆盖'));
  expect(visible()).toContain('尚无真实调用验证记录'); expect(visible()).toContain('未知');
});

test('overview failure offers a real read retry and does not send mutation calls', async () => {
  let fail = true; const calls: string[] = [];
  await start(async tool => { calls.push(tool); if (fail) throw Error('服务暂不可用'); return envelope(overview()); });
  await wait(() => visible().includes('服务暂不可用'));
  expect(container.querySelector('[role=alert]')).not.toBeNull(); fail = false;
  await click('刷新核对'); await wait(() => visible().includes('还没有正在推进的改进'));
  expect(calls).toEqual(['overview', 'overview']);
});

test('completed and waiting work have readable Markdown, safe links and optional plain text', async () => {
  const result = '# 研究结果\n**已核对**\n- 两篇来源\n```text\n<script>unsafe()</script>\n```\n[危险](javascript:alert(1))\n[打开资料](https://example.test/report)';
  await start(async () => envelope({ ...overview(), pursuits: [{ ...pursuit, status: 'waiting', needsDecision: true, waitReason: '请确认范围' }], results: [{ ...pursuit, id: 'done', status: 'done', summary: result, verification: { method: '逐项核对' } }] }));
  await wait(() => visible().includes('研究结果'));
  expect(visible()).toContain('需要你决定'); expect(visible()).toContain('最近完成'); expect(visible()).toContain('请确认范围');
  expect(container.querySelector('strong')?.textContent).toBe('已核对'); expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull(); expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.test/report');
  const toggle = container.querySelector<HTMLInputElement>('input[type=checkbox]')!; toggle.click();
  await wait(() => !!container.querySelector('.mind-plain'));
  expect(container.querySelector('.mind-plain')?.textContent).toContain('**已核对**');
});

test('details wait for evidence; pause, resume, end and feedback use current versions and exact wrapper', async () => {
  let item = { ...pursuit }; let release!: (value: unknown) => void; let hold = true; const writes: any[] = [];
  await start(async (tool, args) => {
    if (tool === 'overview') return envelope(overview([item]));
    if (tool === 'detail') { if (hold) return await new Promise(resolve => { release = resolve; }); return envelope(item); }
    const payload = JSON.parse(args.input); writes.push({ tool, payload });
    if (tool === 'control') item = { ...item, paused: payload.operation === 'pause', status: payload.operation === 'end' ? 'ended' : 'active', revision: item.revision + 1 };
    return envelope({ outcome: 'applied', value: item });
  });
  await wait(() => visible().includes('整理研究资料')); await click('整理研究资料');
  expect(visible()).toContain('正在读取成果与依据'); expect(buttons().some(b => b.textContent === '暂停推进')).toBe(false);
  hold = false; release(envelope(item)); await wait(() => buttons().some(b => b.textContent === '暂停推进'));
  await click('有帮助'); await wait(() => writes.length === 1);
  expect(writes[0].payload).toMatchObject({ targetId: 'p-1', targetKind: 'pursuit', expectedRevision: 4, expectedVisibilityRevision: 7, scope: { projectId: 'research' }, value: 'useful' });
  await wait(() => !button('暂停推进').disabled); await click('暂停推进'); await wait(() => !container.querySelector('.mind-detail'));
  expect(writes[1].payload).toMatchObject({ operation: 'pause', id: 'p-1', kind: 'pursuit', expectedRevision: 4, expectedVisibilityRevision: 7 });
  await click('整理研究资料'); await wait(() => buttons().some(b => b.textContent === '恢复推进'));
  await click('恢复推进'); await wait(() => !container.querySelector('.mind-detail'));
  expect(writes[2].payload.expectedRevision).toBe(5);
  await click('整理研究资料'); await wait(() => buttons().some(b => b.textContent === '结束这件事'));
  await click('结束这件事'); await wait(() => writes.length === 4);
  expect(writes[3].payload.operation).toBe('end'); expect(new Set(writes.map(w => w.payload.actionKey)).size).toBe(4);
});

test('forget requires confirmation, traps keyboard focus and reports the actual cleanup boundary', async () => {
  const understanding = { id: 'u1', revision: 8, value: '偏好中文资料', kind: 'preference', scope: {}, explicitness: 'explicit', status: 'active' };
  const writes: any[] = [];
  await start(async (tool, args) => {
    if (tool === 'overview') return envelope(overview());
    if (tool === 'context') return envelope({ understandings: [understanding] });
    writes.push({ tool, args }); return envelope({ outcome: 'applied', value: { cleanup: { mind: 'complete', external: 'not-requested', nativeExecution: 'requires-owner-reconciliation' } } });
  }, { view: 'understanding' });
  await wait(() => visible().includes('偏好中文资料')); const trigger = button('忘记这条理解'); trigger.focus(); await click('忘记这条理解');
  const dialog = container.querySelector('[role=dialog]')!; expect(dialog.textContent).toContain('不会自动删除原始 Chat'); expect(writes.length).toBe(0);
  expect(window.document.activeElement?.textContent).toBe('取消');
  button('取消').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }) as any);
  expect(window.document.activeElement?.textContent).toBe('确认忘记');
  await click('取消'); expect(container.querySelector('[role=dialog]')).toBeNull(); expect(window.document.activeElement === (trigger as any)).toBe(true);
  await click('忘记这条理解'); await click('确认忘记'); await wait(() => visible().includes('Mind 内清理：已完成'));
  expect(writes.length).toBe(1); expect(Object.keys(writes[0].args)).toEqual(['input']);
  expect(JSON.parse(writes[0].args.input)).toMatchObject({ target: { kind: 'understanding', id: 'u1' }, expectedVisibilityRevision: 7 });
  expect(visible()).toContain('外部内容：未请求清理'); expect(visible()).toContain('原执行：仍需核对停止');
});

test('uncertain natural submission retains input and retries exactly the same action, never double submits', async () => {
  let fail = true; const writes: any[] = [];
  await start(async (tool, args) => {
    if (tool === 'overview') return envelope(overview());
    writes.push({ tool, args }); if (fail) throw Error('响应丢失'); return envelope({ outcome: 'applied', value: { id: 'p2' } });
  });
  await wait(() => visible().includes('还没有正在推进的改进'));
  fill('textarea', '继续跟进论文'); await wait(() => !button('交给 Mind').disabled);
  button('交给 Mind').click(); button('交给 Mind').click();
  await wait(() => visible().includes('重试原请求'));
  expect(writes.length).toBe(1); expect(container.querySelector('textarea')?.value).toBe('继续跟进论文'); expect(button('交给 Mind').disabled).toBe(true);
  const first = JSON.parse(writes[0].args.input); expect(first).toMatchObject({ goal: '继续跟进论文', reason: 'explicit-goal', expectedRevision: 0, completionCriteria: ['核实并解决用户反馈：继续跟进论文', '提供具体改动和验证结果；提交或启用不等于问题解决'] });
  fail = false; await click('重试原请求'); await wait(() => container.querySelector('textarea')?.value === '');
  expect(writes.length).toBe(2); expect(writes[1]).toEqual(writes[0]);
});

test('settings save only edited supported fields and re-read the new revision', async () => {
  let current = { ...settings }; const saves: any[] = [];
  await start(async (tool, args) => {
    if (tool === 'overview') return envelope(overview());
    if (tool === 'settings' && !args.patch) return envelope(current);
    saves.push(args); current = { ...current, ...JSON.parse(args.patch), revision: current.revision + 1 };
    return envelope({ outcome: 'applied', value: current });
  }, { view: 'settings' });
  await wait(() => buttons().some(b => b.textContent === '保存设置' && !b.disabled));
  expect(visible()).toContain('服务尚未提供可修改的预算');
  const toggle = (name: string) => Array.from(container.querySelectorAll('label')).find(label => label.textContent === name)!.querySelector<HTMLInputElement>('input')!;
  const autoSubmit = () => toggle('自动提交检查通过的候选');
  expect(autoSubmit().checked).toBe(false);
  expect(window.document.getElementById(autoSubmit().getAttribute('aria-describedby')!)?.textContent).toBe('只提交候选，仍需审批并核对启用和效果。');
  toggle('从获准的已发送内容学习').click(); await click('保存设置');
  await wait(() => saves.length === 1 && !button('保存设置').disabled);
  expect(saves[0]).toEqual({ patch: JSON.stringify({ learningEnabled: false }), revision: 3 });
  toggle('启用外部通知').click(); await click('保存设置'); await wait(() => saves.length === 2 && !button('保存设置').disabled);
  expect(saves[1].revision).toBe(4); expect(JSON.parse(saves[1].patch)).toEqual({ notifyEnabled: true });
  autoSubmit().click(); await click('保存设置'); await wait(() => saves.length === 3 && !button('保存设置').disabled);
  expect(saves[2]).toEqual({ patch: JSON.stringify({ autoSubmit: true }), revision: 5 });
  autoSubmit().click(); await wait(() => !autoSubmit().checked);
  await click('重新读取'); await wait(() => autoSubmit().checked);
  autoSubmit().click(); await click('保存设置'); await wait(() => saves.length === 4 && !button('保存设置').disabled);
  expect(saves[3]).toEqual({ patch: JSON.stringify({ autoSubmit: false }), revision: 6 });
  expect(autoSubmit().checked).toBe(false);
});

test('understanding errors stop loading, can retry, and referenced evidence is fetched on demand', async () => {
  let fail = true; const detailIds: string[] = [];
  const item = { id: 'u2', revision: 2, value: '资料需附来源', status: 'active', explicitness: 'explicit', supportingRefs: ['e1'], opposingRefs: [], scope: {} };
  await start(async (tool, args) => {
    if (tool === 'overview') return envelope(overview());
    if (tool === 'context') { if (fail) throw Error('理解读取失败'); return envelope({ understandings: [item], truncated: true }); }
    if (tool === 'detail') { detailIds.push(args.id); return envelope(args.id === 'u2' ? item : { id: 'e1', sourceIdentity: 'Chat', occurredAt: '2026-11-13T10:00:00Z', object: { id: 'message-1' }, content: { text: '每条结论请给出来源', truncated: false } }); }
    throw Error('Unexpected tool');
  }, { view: 'understanding' });
  await wait(() => visible().includes('理解读取失败')); expect(visible()).not.toContain('正在读取相关理解');
  fail = false; await click('重试读取理解'); await wait(() => visible().includes('资料需附来源'));
  expect(visible()).toContain('截断'); await click('依据与纠正'); await wait(() => visible().includes('每条结论请给出来源'));
  expect(detailIds).toEqual(['u2', 'e1']); expect(visible()).toContain('message-1');
});

test('destroy removes the host and ignores a late overview response', async () => {
  let release!: (value: unknown) => void;
  await start(() => new Promise(resolve => { release = resolve; }));
  lifecycle!.destroy(); lifecycle!.destroy(); release(envelope(overview([pursuit])));
  await new Promise(resolve => setTimeout(resolve, 15)); expect(container.childElementCount).toBe(0);
  expect(logs.join('\n')).not.toContain('secret-user-text');
});

test('real document body and format render in details', async () => {
  await start(async tool => tool === 'overview' ? envelope(overview([pursuit])) : envelope({ ...pursuit, artifacts: [{ ref: 'doc:1', title: '研究结论', body: '**真实成果正文**', format: 'markdown' }, { ref: 'doc:2', title: '原文', body: '**保留文本标记**', format: 'text' }], evidence: [] }));
  await wait(() => visible().includes('整理研究资料')); await click('整理研究资料');
  await wait(() => visible().includes('真实成果正文'));
  expect(container.querySelector('.mind-artifact strong')?.textContent).toBe('真实成果正文');
  expect(container.querySelector('.mind-artifact .mind-plain')?.textContent).toBe('**保留文本标记**');
});

test('forget invalidates older context and detail replies before they can restore removed content', async () => {
  const item = { id: 'u-forget', revision: 1, value: '将被忘记的内容', status: 'active', scope: {} };
  let reads = 0, releaseContext!: (value: unknown) => void, releaseDetail!: (value: unknown) => void;
  await start(async (tool) => {
    if (tool === 'overview') return envelope(overview());
    if (tool === 'context') { reads++; if (reads === 2) return new Promise(resolve => { releaseContext = resolve; }); return envelope({ understandings: reads === 1 ? [item] : [] }); }
    if (tool === 'detail') return new Promise(resolve => { releaseDetail = resolve; });
    return envelope({ outcome: 'applied', value: { cleanup: { mind: 'complete' } } });
  }, { view: 'understanding' });
  await wait(() => visible().includes(item.value)); await click('搜索'); await click('依据与纠正');
  await wait(() => !!releaseContext && !!releaseDetail); await click('忘记这条理解'); await click('确认忘记');
  await wait(() => visible().includes('Mind 内清理：已完成'));
  releaseContext(envelope({ understandings: [item] })); releaseDetail(envelope(item));
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(visible()).not.toContain(item.value); expect(container.querySelector('.mind-detail')).toBeNull();
});

test('a structured conflict releases the pending write and refresh allows a new action identity', async () => {
  const writes: any[] = []; let fence = 7;
  await start(async (tool, args) => {
    if (tool === 'overview') return envelope({ ...overview(), visibilityRevision: fence });
    writes.push(JSON.parse(args.input));
    if (writes.length === 1) throw Object.assign(new Error('版本已变化'), { code: 'CONFLICT' });
    return envelope({ outcome: 'applied', value: {} });
  });
  await wait(() => visible().includes('还没有正在推进的改进')); fill('textarea', '刷新版本后继续');
  await wait(() => !button('交给 Mind').disabled); await click('交给 Mind'); await wait(() => visible().includes('版本已变化'));
  expect(visible()).not.toContain('上一请求的结果尚不确定'); expect(container.querySelector('textarea')?.value).toBe('刷新版本后继续');
  fence = 8; await click('刷新核对'); await wait(() => !button('交给 Mind').disabled); await click('交给 Mind'); await wait(() => writes.length === 2);
  expect(writes[1].expectedVisibilityRevision).toBe(8); expect(writes[1].actionKey).not.toBe(writes[0].actionKey);
});

test('project and session scope search and corrected understanding show the fresh value', async () => {
  let item = { id: 'u-scope', revision: 1, value: '项目中文偏好', scope: { projectId: 'project-a', sessionId: 'session-a' }, status: 'active', explicitness: 'explicit' };
  const contexts: any[] = [], writes: any[] = [];
  await start(async (tool, args) => {
    if (tool === 'overview') return envelope(overview([item]));
    if (tool === 'context') { contexts.push(args); return envelope({ understandings: [item] }); }
    if (tool === 'detail') return envelope(item);
    const payload = JSON.parse(args.input); writes.push(payload); item = { ...item, value: payload.value, revision: 2 };
    return envelope({ outcome: 'applied', value: item });
  }, { view: 'understanding' });
  await wait(() => visible().includes(item.value)); fill('input[aria-label="项目范围"]', 'project-a'); fill('input[aria-label="会话范围"]', 'session-a');
  await click('搜索'); expect(contexts.at(-1).scope).toEqual(item.scope);
  await click('依据与纠正'); await wait(() => !!container.querySelector('.mind-detail') && buttons().some(b => b.textContent === '有帮助'));
  fill('textarea', '已纠正项目偏好'); await wait(() => !button('补充这件事').disabled); await click('补充这件事');
  await wait(() => !container.querySelector('.mind-detail') && visible().includes('已纠正项目偏好'));
  expect(visible()).not.toContain('项目中文偏好'); expect(writes[0]).toMatchObject({ operation: 'correct', kind: 'understanding', value: '已纠正项目偏好', expectedRevision: 1 });
});

test('natural pursuit supplement retains original goal and completion criteria', async () => {
  const item = { ...pursuit, completionCriteria: ['每条结论附来源'] }; let payload: any;
  await start(async (tool, args) => {
    if (tool === 'overview') return envelope(overview([item]));
    if (tool === 'detail') return envelope(item);
    if (tool === 'context') return envelope({ understandings: [] });
    payload = JSON.parse(args.input); return envelope({ outcome: 'applied', value: {} });
  });
  await wait(() => visible().includes(item.goal)); await click(item.goal); await wait(() => buttons().some(b => b.textContent === '有帮助'));
  fill('textarea', '预算控制在 500 元以内'); await wait(() => !button('补充这件事').disabled); await click('补充这件事'); await wait(() => !!payload);
  expect(payload.value).toBe('整理研究资料\n补充要求：预算控制在 500 元以内');
  expect(payload.completionCriteria).toEqual(['每条结论附来源', '预算控制在 500 元以内']);
});

test('real temporary Core service accepts owner input, control and confirmed forgetting through the UI contract', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { CoreMindStore } = await import('./core-store');
  const { CoreMindService } = await import('./core-service');
  const owner = { subject: 'ui-test-owner', role: 'owner' as const, scopes: [{}] };
  const directory = mkdtempSync(join(tmpdir(), 'mind-workspace-dom-'));
  const store = new CoreMindStore(directory), service = new CoreMindService(store);
  try {
    await start(async (tool, args) => {
      const input = args.input ? JSON.parse(args.input) : undefined;
      switch (tool) {
        case 'overview': return envelope(service.overview(args, owner));
        case 'context': return envelope(service.context(args as any, owner));
        case 'pursue': return envelope(service.pursue(input, owner));
        case 'remember': return envelope(service.remember(input, owner));
        case 'control': return envelope(service.control(input, owner));
        case 'forget': return envelope(service.forget(input, owner));
        case 'detail': {
          const item = service.overview({}, owner).items.find(i => i.id === args.id)!;
          return envelope(service.detail({ id: args.id, kind: 'goal' in item ? 'pursuit' : 'understanding' }, owner));
        }
        default: throw Error('Unexpected local UI tool: ' + tool);
      }
    });
    await wait(() => visible().includes('还没有正在推进的改进'));
    fill('textarea', '整理真正可用的研究清单'); await wait(() => !button('交给 Mind').disabled); await click('交给 Mind');
    await wait(() => !!buttons().find(b => b.textContent === '整理真正可用的研究清单'));
    const saved = store.read().pursuits[0]; expect(saved.goal).toBe('整理真正可用的研究清单'); expect(saved.completionCriteria).toEqual([`核实并解决用户反馈：${saved.goal}`, '提供具体改动和验证结果；提交或启用不等于问题解决']);
    await click(saved.goal); await wait(() => buttons().some(b => b.textContent === '暂停推进')); await click('暂停推进');
    await wait(() => store.read().pursuits[0].paused && !container.querySelector('.mind-detail'));
    expect(store.read().pursuits[0].revision).toBeGreaterThan(saved.revision);
    const mode = container.querySelector<HTMLSelectElement>('.mind-input-mode select')!;
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(mode, 'remember');
    mode.dispatchEvent(new window.Event('change', { bubbles: true }) as any);
    fill('textarea', '研究结果请用中文'); await wait(() => !button('保存理解').disabled); await click('保存理解');
    await wait(() => store.read().understandings.length === 1 && container.querySelector('textarea')?.value === '');
    await click('理解与反馈'); await wait(() => visible().includes('研究结果请用中文'));
    await click('忘记这条理解'); await click('确认忘记');
    await wait(() => !container.querySelector('[role=dialog]') && !visible().includes('研究结果请用中文'));
    expect(store.read().understandings[0].value).toBe(''); expect(store.read().visibilityRevision).toBeGreaterThan(saved.visibilityRevision);
    expect(visible()).toContain('Mind 内清理：已完成');
  } finally {
    lifecycle?.destroy(); lifecycle = undefined; store.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('four destinations separate overview, improvements, understanding and settings; technical forms stay collapsed',async()=>{
  const items=Array.from({length:6},(_,i)=>({...pursuit,id:`item-${i}`,goal:`改进应用 ${i}`}));
  const calls:string[]=[];
  await start(async tool=>{calls.push(tool);if(tool==='overview')return envelope(overview(items));if(tool==='delivery')return envelope({items:[],nextCursor:null});if(tool==='settings')return envelope(settings);if(tool==='context')return envelope({understandings:[]});throw Error('Unexpected tool');});
  await wait(()=>visible().includes('改进应用 0'));
  expect(Array.from(container.querySelectorAll('.mind-tabs button')).map(b=>b.textContent)).toEqual(['概览','改进','理解与反馈','设置']);
  expect(container.querySelectorAll('.mind-card')).toHaveLength(3);
  await click('改进');await wait(()=>container.querySelectorAll('.mind-card').length===6);expect(visible()).toContain('候选改动');
  await click('设置');await wait(()=>!!buttons().find(b=>b.textContent==='保存设置'));
  expect(calls).not.toContain('applications');expect(container.querySelector('.mind-composer')).toBeNull();
});

test('application feedback carries selected application, version and page with observable completion criteria',async()=>{
  const writes:any[]=[];
  await start(async(tool,args)=>{if(tool==='overview')return envelope({...overview(),applications:[{id:'chat-real',name:'chat',activeHash:'a'.repeat(40)}]});writes.push({tool,input:JSON.parse(args.input)});return envelope({outcome:'applied',value:{}});});
  await wait(()=>!!container.querySelector('option[value="chat-real"]'));
  const select=container.querySelector<HTMLSelectElement>('[aria-label="涉及应用"]')!;select.value='chat-real';select.dispatchEvent(new window.Event('change',{bubbles:true}) as any);
  fill('[aria-label="问题所在页面"]','会话页');fill('textarea','发送失败后不能继续');await click('交给 Mind');await wait(()=>writes.length===1);
  expect(writes[0].tool).toBe('pursue');expect(writes[0].input.goal).toContain('改进 chat：发送失败后不能继续');expect(writes[0].input.goal).toContain('a'.repeat(40));expect(writes[0].input.goal).toContain('会话页');expect(writes[0].input.completionCriteria).toContain('提供具体改动和验证结果；提交或启用不等于问题解决');
});

test('user can reopen an unresolved completed improvement from its detail',async()=>{
  const writes:any[]=[];const item={...pursuit,status:'done'};
  await start(async(tool,args)=>{if(tool==='overview')return envelope(overview([item]));if(tool==='detail')return envelope({...item,evidence:[],artifacts:[]});writes.push({tool,input:JSON.parse(args.input)});return envelope({outcome:'applied',value:{}});});
  await wait(()=>visible().includes(item.goal));await click(item.goal);await wait(()=>buttons().some(b=>b.textContent==='仍未解决，继续改进'));await click('仍未解决，继续改进');await wait(()=>writes.length===1);
  expect(writes[0]).toMatchObject({tool:'feedback',input:{targetKind:'pursuit',targetId:item.id,value:'restart',expectedRevision:item.revision}});
});

const feedbackGoal = `改进 应用中心：改善应用列表的布局与操作\n反馈对应版本：${'a'.repeat(40)}；应用：a72dc177-cd15-47fa-9335-18e2ec58e4c2；页面：/p/apps/available`;
const readableTitle = '改进 应用中心：改善应用列表的布局与操作';

test('existing goal supplies the same readable task and detail title; original identity stays expandable', async () => {
  const item = { ...pursuit, goal: feedbackGoal, updatedAt: '2026-11-15T12:08:48Z' };
  await start(async tool => envelope(tool === 'overview' ? overview([item]) : item));
  await wait(() => !!container.querySelector('.mind-title-button'));
  const card = container.querySelector('.mind-card')!;
  expect(card.querySelector('h3')?.textContent).toBe(readableTitle);
  const technical = card.querySelector('details')!;
  expect(technical.open).toBe(false);
  expect(technical.textContent).toContain(item.id);
  expect(technical.textContent).toContain(feedbackGoal);
  technical.querySelector('summary')!.click();
  expect(technical.open).toBe(true);
  await click(readableTitle);
  await wait(() => !!container.querySelector('.mind-detail .mind-tag'));
  expect(container.querySelector('.mind-detail h2')?.textContent).toBe(readableTitle);
  expect(container.querySelector<HTMLDetailsElement>('.mind-detail details')?.open).toBe(false);
});

for (const [status, waitFor, waitReason, nextStep, expected] of [
  ['waiting', 'user', '应用已启用，等待用户验收', '刷新页面并验收布局', '待你验收'],
  ['waiting', 'user', '需要补充页面截图', '提供截图', '需要你处理'],
  ['waiting', 'permission', '需要批准才能继续核验', '审阅候选改动', '需要你处理'],
  ['waiting', 'external', '等待外部回执', '查询原回执', '等待条件'],
  ['failed', undefined, '检查未通过', '查看失败原因', '执行失败'],
  ['finished', undefined, '执行已结束，目标尚未核对', '核对实际效果', '本轮执行结束'],
  ['active', undefined, '', '核对页面效果', '正在推进'],
  ['done', undefined, '', '', '已完成'],
] as const) {
  test(`task card and detail retain truthful ${status}/${waitFor} status`, async () => {
    const item = { ...pursuit, goal: feedbackGoal, status, waitFor, waitReason, nextStep, currentActor: { runRef: 'finished-run' } };
    await start(async tool => envelope(tool === 'overview' ? overview([item]) : item));
    await wait(() => !!container.querySelector('.mind-title-button'));
    expect(container.querySelector('.mind-card .mind-tag')?.textContent).toBe(expected);
    expect(container.querySelector('.mind-card h3')?.textContent).toBe(readableTitle);
    if (status !== 'done') expect(container.querySelector('[aria-label="最近完成"]')).toBeNull();
    await click(readableTitle);
    await wait(() => !!container.querySelector('.mind-detail .mind-tag'));
    expect(container.querySelector('.mind-detail .mind-tag')?.textContent).toBe(expected);
    expect(container.querySelector('.mind-detail')?.textContent).toContain(nextStep);
  });
}

test('artifact titles retain their meaning and technical references can be expanded', async () => {
  const artifact = { id: 'artifact-001', ref: `doc:${'b'.repeat(64)}`, title: `应用列表改版 · ${'b'.repeat(64)}`, body: '已调整布局；等待你确认实际效果。', format: 'text' };
  const item = { ...pursuit, goal: feedbackGoal, artifactRefs: [artifact.ref] };
  await start(async tool => envelope(tool === 'overview' ? overview([item]) : { pursuit: item, artifacts: [artifact, { ref: 'doc:untitled', body: '核验记录' }], evidence: [] }));
  await wait(() => !!container.querySelector('.mind-title-button'));
  await click(readableTitle);
  await wait(() => container.querySelectorAll('.mind-artifact').length === 2);
  const cards = Array.from(container.querySelectorAll('.mind-artifact'));
  expect(cards.map(card => card.querySelector('h4')?.textContent)).toEqual(['应用列表改版', `${readableTitle} · 成果`]);
  const technical = cards[0]!.querySelector('details')!;
  expect(technical.open).toBe(false);
  technical.querySelector('summary')!.click();
  expect(technical.open).toBe(true);
  expect(technical.textContent).toContain(artifact.ref);
  expect(technical.textContent).toContain(artifact.id);
  expect(container.querySelector('.mind-detail')?.textContent).toContain('等待你确认实际效果');
});
