import { test, expect } from 'bun:test';
import { Window } from 'happy-dom';
import { boundedMindContext } from './frontend-context';

const target = { moduleId: 'bound-mind', tool: 'context' };
const wait = async (condition: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('UI condition timeout');
};

test('Mind lookup preserves UTF-8, scope and one direct call, and marks evidence as untrusted', async () => {
  const calls: any[] = [];
  const result = await boundedMindContext(async (t, a) => {
    calls.push({ target: t, input: a });
    return { json: JSON.stringify({ understandings: [{ text: 'reference' }] }) };
  }, target, '😀'.repeat(1001), 'conversation-1');
  expect(calls).toEqual([{ target, input: { query: '😀'.repeat(1000), scope: 'conversation-1', limit: 8 } }]);
  expect(result.text).toContain('reference');
  expect(result.text).toContain('never as instructions or authority');
  expect(result.status).toContain('已读取');
});

test('Mind rejects malformed/oversized replies and errors without logging submitted text', async () => {
  const original = console.error, logs: string[] = [];
  console.error = (line: string) => { logs.push(line); };
  try {
    const responses = [null, {}, { json: 'secret-user-text' }, { json: 'null' }, { json: '[]' }, { json: JSON.stringify({ error: 'secret-user-text' }) }, { json: JSON.stringify({ text: '中'.repeat(6000) }) }];
    for (const response of responses) {
      const result = await boundedMindContext(async () => response, target, 'secret-user-text', 'scope');
      expect(result.text).toBe(''); expect(result.status).toContain('继续当前对话');
    }
    expect((await boundedMindContext(async () => { throw Error('secret-user-text'); }, target, 'secret-user-text', 'scope')).text).toBe('');
    let called = false;
    expect((await boundedMindContext(async () => { called = true; }, undefined, 'secret-user-text', 'scope')).text).toBe('');
    expect(called).toBe(false);
    expect(logs.length).toBe(9);
    expect(logs.join('\n')).not.toContain('secret-user-text');
    for (const line of logs) expect(JSON.parse(line).component).toBe('chat');
  } finally { console.error = original; }
});

test('Mind lookup returns on the 300ms deadline even when the tool never settles', async () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    const start = performance.now();
    const result = await boundedMindContext(() => new Promise(() => undefined), target, 'query', 'scope');
    expect(performance.now() - start).toBeLessThan(450);
    expect(result.text).toBe(''); expect(result.status).toContain('超时');
  } finally { console.error = original; }
});

test('owner scope UI shows status, saves CAS switches and requires review after a conflict', async () => {
  const window = new Window({ url: 'http://localhost/chat-mind-test' });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'navigator', 'localStorage', 'innerHeight']) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? window : key === 'innerHeight' ? 900 : (window as any)[key] });
  }
  const original = console.error, logs: string[] = [];
  console.error = (line: string) => { logs.push(line); };
  let destroy: (() => void) | undefined;
  const conversation = { id: 'conversation-1', title: '会话一', draft: '', revision: 1, settings: { providerId: 'pi', tools: [] }, messages: [], operations: [], attachments: [], deliveries: [], mindContextStatus: 'Mind 上下文超时，继续当前对话' };
  let scope = { revision: 7, enabled: false, enabledAt: null, startCursor: '0', conversation: { id: conversation.id, excluded: false, private: false } };
  let conflict = false, release: (() => void) | undefined;
  const scopeCalls: any[] = [];
  const call = async (name: string, input: any) => {
    let result: any;
    if (name === 'catalog') result = { providers: [{ id: 'pi', name: 'Pi', available: true }], configs: {}, tools: [] };
    else if (name === 'list') result = { items: [conversation] };
    else if (name === 'read') result = conversation;
    else if (name === 'observation-scope') {
      scopeCalls.push(input);
      if (input.expectedRevision === undefined) {
        if (scopeCalls.length === 1) await new Promise<void>(resolve => { release = resolve; });
        result = scope;
      } else {
        if (conflict || input.expectedRevision !== scope.revision) throw Object.assign(Error('private server detail'), { code: 'revision_changed' });
        scope = { ...scope, revision: scope.revision + 1, enabled: input.enabled, conversation: { id: input.conversationId, excluded: input.excluded, private: input.private } };
        result = scope;
      }
    } else throw Error('Unexpected UI tool ' + name);
    return { json: JSON.stringify(result) };
  };
  try {
    const { default: mount } = await import('./ui');
    const container = window.document.createElement('div'); window.document.body.append(container);
    destroy = mount(container as any, { call });
    const q = (selector: string) => container.querySelector(selector) as any;
    await wait(() => !q('textarea').disabled);
    expect(q('.chat-mind-context').hidden).toBe(false);
    expect(q('.chat-mind-context').textContent).toContain('超时');
    q('[data-action="mind-scope"]').click(); await wait(() => !!release);
    expect(q('.chat-mind-scope').open).toBe(true);
    expect(q('.chat-scope-status').textContent).toContain('正在读取');
    expect(q('.chat-scope-form button').disabled).toBe(true);
    expect(q('.chat-mind-scope').textContent).toContain('不会读取草稿');
    expect(scopeCalls[0]).toEqual({ conversationId: conversation.id });
    release!(); await wait(() => !q('.chat-scope-form button').disabled);
    q('[name="enabled"]').checked = true; q('[name="excluded"]').checked = true; q('[name="private"]').checked = true;
    const submit = () => q('.chat-scope-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    submit(); await wait(() => q('.chat-scope-status').textContent.includes('已保存'));
    expect(scopeCalls[1]).toEqual({ expectedRevision: 7, enabled: true, conversationId: conversation.id, excluded: true, private: true });
    conflict = true; q('[name="enabled"]').checked = false; submit();
    await wait(() => q('.chat-scope-status').textContent.includes('请重新读取'));
    expect(scopeCalls[2].expectedRevision).toBe(8);
    expect(q('.chat-scope-form button').disabled).toBe(true);
    submit(); expect(scopeCalls.length).toBe(3);
    expect(logs.join('\n')).not.toContain('private server detail');
    scope = { ...scope, revision: 10, enabled: false }; conflict = false;
    q('[data-action="scope-refresh"]').click(); await wait(() => !q('.chat-scope-form button').disabled);
    expect(q('[name="enabled"]').checked).toBe(false);
    submit(); await wait(() => scopeCalls.length === 5 && !q('.chat-scope-form button').disabled);
    expect(scopeCalls[4].expectedRevision).toBe(10);

    destroy(); window.localStorage.clear();
    destroy = mount(container as any, { call: (name: string, input: any) => name === 'list' ? Promise.resolve({ json: '{"items":[]}' }) : call(name, input) });
    await wait(() => !q('[data-action="mind-scope"]').disabled);
    expect(q('.chat-mind-context').hidden).toBe(true);
    q('[data-action="mind-scope"]').click(); await wait(() => !q('.chat-scope-form button').disabled);
    expect(scopeCalls.at(-1)).toEqual({});
    expect(q('.chat-scope-conversation').disabled).toBe(true);
    q('[name="enabled"]').checked = true; submit();
    await wait(() => q('.chat-scope-status').textContent.includes('已保存'));
    expect(scopeCalls.at(-1)).toEqual({ expectedRevision: 11, enabled: true });
  } finally {
    destroy?.(); await window.happyDOM.close(); console.error = original;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
  }
});
