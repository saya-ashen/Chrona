import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { ApplicationAdapter } from './core-application';
import type { MindContext } from './workspace-ui';

const window = new Window({ url: 'http://localhost/mind-applications-test' });
const previous = new Map<string, PropertyDescriptor | undefined>();
let mount: typeof import('./workspace-ui').default;
let lifecycle: ReturnType<typeof mount> | undefined;
let container: HTMLElement;
const originalError = console.error;
const envelope = (value: unknown) => ({ json: JSON.stringify(value) });
const grant = { moduleId: 'timetable-real', activeHash: 'exact-reviewed-source-v1', tool: 'lookup', effect: 'read' as const, params: { route: 'one', limit: 3 }, description: '读取线路一的三条公开时刻' };
const adapter: ApplicationAdapter = { ...grant, id: 'owner:reviewed-read', source: 'owner', grantedBy: 'owner:local', grantedAt: '2026-11-13T00:00:00Z' };
const builtin: ApplicationAdapter = { ...adapter, id: 'builtin:pi.models:hash', moduleId: 'pi-real', activeHash: 'pi-version', tool: 'models', params: {}, source: 'builtin', description: '本地模型选项目录' };
const visible = () => container.textContent ?? '';
const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
const button = (name: string) => {
    const found = buttons().find(b => b.textContent?.trim() === name);
    if (!found) throw Error(`Missing button: ${name}; ${visible()}`);
    return found;
};
async function wait(condition: () => boolean) {
    for (let i = 0; i < 240; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
    throw Error(`DOM timeout: ${visible()}`);
}
async function click(name: string) { button(name).click(); await new Promise(resolve => setTimeout(resolve, 8)); }
function fill(name: string, value: string) {
    const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${name}"]`)!;
    const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event);
}
async function draft(params = JSON.stringify(grant.params)) {
    fill('应用 ID', grant.moduleId); fill('精确版本', grant.activeHash); fill('工具', grant.tool);
    fill('读取范围说明', grant.description); fill('固定参数（JSON 对象）', params);
    await click('审阅此读取');
}
async function confirmReview() {
    container.querySelector<HTMLInputElement>('.mind-application-review input[type=checkbox]')!.click();
    await new Promise(resolve => setTimeout(resolve, 8));
}
type CallRecord = { tool: string; args: Record<string, unknown> };
async function start(applications: (input: Record<string, any>) => unknown | Promise<unknown>) {
    const calls: CallRecord[] = [];
    container = window.document.createElement('div') as unknown as HTMLElement;
    window.document.body.append(container as any);
    const call: MindContext['call'] = async (tool, args) => {
        calls.push({ tool, args: structuredClone(args) });
        if (tool === 'overview') return envelope({ items: [], visibilityRevision: 7, settings: { learningEnabled: true } });
        if (tool === 'settings') return envelope({ revision: 1, enabled:true, learningEnabled:true, notifyEnabled:false, autoSubmit:false, timezone:'UTC', quietStart:'23:00', quietEnd:'08:00' });
        if (tool === 'context') return envelope({ understandings: [] });
        if (tool === 'applications') return applications(JSON.parse(args.input));
        throw Error('Unexpected tool: ' + tool);
    };
    lifecycle = mount(container, { call, props: { view: 'settings' } });
    await wait(()=>!!container.querySelector('.mind-source-settings summary'));
    container.querySelector<HTMLElement>('.mind-source-settings summary')!.click();
    await wait(() => calls.some(c => c.tool === 'applications'));
    return calls;
}
const mutations = (calls: CallRecord[]) => calls.filter(c => c.tool === 'applications' && JSON.parse(c.args.input as string).operation !== 'list');
beforeAll(async () => {
    for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'navigator', 'Event', 'MouseEvent', 'KeyboardEvent']) {
        previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? window : (window as any)[key] });
    }
    // Malformed replies and rejected configuration are expected; no raw params are logged.
    console.error = () => undefined;
    mount = (await import('./workspace-ui')).default;
});
afterEach(() => { lifecycle?.destroy(); lifecycle = undefined; window.document.body.replaceChildren(); });
afterAll(async () => {
    await new Promise(resolve => setTimeout(resolve, 25));
    await window.happyDOM.abort(); console.error = originalError;
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
});

test('Connections reads the actual array envelope and shows exact targets with owner-only revocation', async () => {
    const calls = await start(() => envelope([builtin, adapter]));
    await wait(() => visible().includes(adapter.id));
    expect(calls.find(c => c.tool === 'applications')).toEqual({ tool: 'applications', args: { input: JSON.stringify({ operation: 'list' }) } });
    expect(visible()).toContain(grant.activeHash); expect(visible()).toContain(grant.moduleId);
    expect(visible()).toContain('内置已审阅读取'); expect(visible()).toContain('模型不能授予权限');
    expect(buttons().filter(b => b.textContent === '撤销此读取')).toHaveLength(1);
    expect(mutations(calls)).toEqual([]);
});

test('loading, empty inventory and list failure remain distinct and recover by reading again', async () => {
    let release!: (value: unknown) => void;
    let fail = false;
    await start(() => { if (fail) throw Error('目录读取失败'); return new Promise(resolve => { release = resolve; }); });
    expect(visible()).toContain('正在读取获准的应用'); expect(visible()).not.toContain('尚无获准的应用读取');
    release(envelope([])); await wait(() => visible().includes('尚无获准的应用读取'));
    fail = true; await click('重新读取应用列表'); await wait(() => visible().includes('目录读取失败'));
    expect(visible()).not.toContain('尚无获准的应用读取');
    fail = false; await click('重新读取应用列表'); release(envelope([adapter]));
    await wait(() => visible().includes(adapter.id)); expect(visible()).not.toContain('目录读取失败');
});

test('grant waits for source review confirmation and sends only the exact reviewed configuration', async () => {
    let granted = false;
    const calls = await start(input => input.operation === 'list' ? envelope(granted ? [adapter] : []) : (granted = true, envelope(adapter)));
    await wait(() => visible().includes('尚无获准的应用读取')); await draft();
    expect(mutations(calls)).toEqual([]);
    expect(button('确认允许读取').disabled).toBe(true);
    const review = container.querySelector('[aria-label="确认应用读取变更"]')!;
    expect(review.textContent).toContain(grant.activeHash); expect(review.textContent).toContain('"limit": 3');
    await confirmReview(); await click('确认允许读取');
    await wait(() => visible().includes('已允许这项经过审阅的应用读取。') && visible().includes(adapter.id));
    expect(mutations(calls)).toEqual([{ tool: 'applications', args: { input: JSON.stringify({ operation: 'grant', ...grant }) } }]);
    expect(container.querySelector('[aria-label="确认应用读取变更"]')).toBeNull();
});

test('revoke reviews the exact adapter identity and refreshes the actual list', async () => {
    let revoked = false;
    const calls = await start(input => input.operation === 'list' ? envelope(revoked ? [builtin] : [builtin, adapter]) : (revoked = true, envelope({ ...adapter, revokedAt: '2026-11-14T00:00:00Z' })));
    await wait(() => visible().includes(adapter.id)); await click('撤销此读取');
    expect(container.querySelector('.mind-application-review')?.textContent).toContain(adapter.id);
    expect(button('确认撤销读取').disabled).toBe(true); expect(mutations(calls)).toEqual([]);
    await confirmReview(); await click('确认撤销读取');
    await wait(() => visible().includes('已撤销这项应用读取。') && !visible().includes(adapter.id));
    expect(mutations(calls)).toEqual([{ tool: 'applications', args: { input: JSON.stringify({ operation: 'revoke', adapterId: adapter.id }) } }]);
    expect(visible()).toContain(builtin.description);
});

test('invalid fixed params cannot reach review or dispatch, and remain editable', async () => {
    const calls = await start(() => envelope([])); await wait(() => !button('重新读取应用列表').disabled);
    for (const invalid of ['{broken', '[]', 'null', '"text"', '3', '{"number":1e400}', '{"body":"' + 'x'.repeat(8192) + '"}']) {
        await draft(invalid);
        expect(container.querySelector('[aria-label="确认应用读取变更"]')).toBeNull();
        expect(container.querySelector('[role=alert]')).not.toBeNull();
        expect(container.querySelector<HTMLTextAreaElement>('[aria-label="固定参数（JSON 对象）"]')!.value).toBe(invalid);
    }
    expect(mutations(calls)).toEqual([]);
    await draft(); expect(button('确认允许读取').disabled).toBe(true);
});

test('lost grant reply preserves the reviewed command and retry sends byte-identical payload', async () => {
    let attempts = 0;
    const calls = await start(input => {
        if (input.operation === 'list') return envelope(attempts ? [adapter] : []);
        attempts++; if (attempts === 1) throw Error('回复丢失');
        return envelope(adapter);
    });
    await wait(() => !button('重新读取应用列表').disabled); await draft(); await confirmReview(); await click('确认允许读取');
    await wait(() => visible().includes('上一请求的结果尚不确定'));
    expect(visible()).not.toContain('已允许这项经过审阅的应用读取。'); expect(button('确认允许读取').disabled).toBe(true);
    expect(button('返回修改').disabled).toBe(true);
    await click('刷新核对'); await wait(() => visible().includes(adapter.id));
    expect(visible()).toContain('上一请求的结果尚不确定'); expect(visible()).not.toContain('已允许这项经过审阅的应用读取。');
    await click('重试原请求'); await wait(() => visible().includes('已允许这项经过审阅的应用读取。'));
    const writes = mutations(calls); expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
});

test('unknown, failed, malformed and mismatched grant replies never confirm success', async () => {
    const replies: unknown[] = [{ status: 'unknown' }, { status: 'failed', message: 'not applied' }, undefined, { ...adapter, activeHash: 'other-version' }, { ...adapter, status: 'unknown' }];
    let attempt = 0;
    const calls = await start(input => input.operation === 'list' ? envelope([]) : replies[attempt] === undefined ? (attempt++, undefined) : envelope(replies[attempt++]));
    await wait(() => !button('重新读取应用列表').disabled); await draft(); await confirmReview(); await click('确认允许读取');
    for (let i = 0; i < replies.length; i++) {
        await wait(() => visible().includes('上一请求的结果尚不确定') && !button('重试原请求').disabled);
        expect(visible()).not.toContain('已允许这项经过审阅的应用读取。');
        expect(button('确认允许读取').disabled).toBe(true);
        if (i + 1 < replies.length) await click('重试原请求');
    }
    expect(mutations(calls)).toHaveLength(replies.length);
    for (const mutation of mutations(calls)) expect(mutation).toEqual(mutations(calls)[0]);
});

test('lost revoke reply retries the same adapter ID and rejects a reply for another grant', async () => {
    let attempt = 0;
    const calls = await start(input => {
        if (input.operation === 'list') return envelope([adapter]);
        attempt++; if (attempt === 1) throw Error('撤销回复丢失');
        return envelope({ ...adapter, id: attempt === 2 ? 'owner:another' : adapter.id, revokedAt: '2026-11-14T00:00:00Z' });
    });
    await wait(() => visible().includes(adapter.id)); await click('撤销此读取'); await confirmReview(); await click('确认撤销读取');
    await wait(() => visible().includes('上一请求的结果尚不确定')); expect(visible()).not.toContain('已撤销这项应用读取。');
    await click('重试原请求'); expect(visible()).not.toContain('已撤销这项应用读取。');
    await click('重试原请求'); await wait(() => visible().includes('已撤销这项应用读取。'));
    const writes = mutations(calls); expect(writes).toHaveLength(3);
    for (const mutation of writes) expect(mutation).toEqual({ tool: 'applications', args: { input: JSON.stringify({ operation: 'revoke', adapterId: adapter.id }) } });
});

test('structured owner rejection does not claim success or send authority claims', async () => {
    const calls = await start(input => { if (input.operation === 'list') return envelope([]); throw Object.assign(Error('仅所有者可以配置'), { code: 'FORBIDDEN' }); });
    await wait(() => !button('重新读取应用列表').disabled); await draft(); await confirmReview(); await click('确认允许读取');
    await wait(() => visible().includes('仅所有者可以配置'));
    expect(visible()).not.toContain('上一请求的结果尚不确定'); expect(visible()).not.toContain('已允许这项经过审阅的应用读取。');
    expect(JSON.parse(mutations(calls)[0].args.input as string)).toEqual({ operation: 'grant', ...grant });
    expect(button('返回修改').disabled).toBe(false);
});

test('invalid inventory is an error rather than an empty or partially accepted list', async () => {
    let response: unknown = { items: [adapter] };
    await start(() => envelope(response)); await wait(() => visible().includes('应用读取列表返回内容无效'));
    for (const invalid of [[adapter, { id: 'broken' }], [adapter, adapter], [{ ...adapter, revokedAt: '2026-11-14T00:00:00Z' }]]) {
        response = invalid; await click('重新读取应用列表');
        await wait(() => visible().includes('应用读取列表返回内容无效'));
        expect(visible()).not.toContain('尚无获准的应用读取');
        expect(buttons().filter(b => b.textContent === '撤销此读取')).toHaveLength(0);
    }
    response = [adapter]; await click('重新读取应用列表'); await wait(() => visible().includes(adapter.id));
    const { callMind } = await import('./workspace-ui');
    await expect(callMind({ call: async () => envelope([adapter]) }, 'overview')).rejects.toThrow('Mind 返回内容无效');
});

test('a late obsolete inventory cannot replace the refreshed list', async () => {
    let release!: (value: unknown) => void;
    let reads = 0;
    await start(() => ++reads === 1 ? new Promise(resolve => { release = resolve; }) : envelope([adapter]));
    await click('刷新'); await wait(() => visible().includes(adapter.id));
    release(envelope([builtin])); await new Promise(resolve => setTimeout(resolve, 15));
    expect(visible()).toContain(adapter.id); expect(visible()).not.toContain(builtin.description);
});

test('returning to edit requires a fresh review of the changed exact version', async () => {
    const calls = await start(() => envelope([])); await wait(() => !button('重新读取应用列表').disabled);
    await draft(); await confirmReview(); expect(button('确认允许读取').disabled).toBe(false);
    await click('返回修改'); fill('精确版本', 'reviewed-source-v2'); await click('审阅此读取');
    expect(container.querySelector('.mind-application-review')?.textContent).toContain('reviewed-source-v2');
    expect(button('确认允许读取').disabled).toBe(true); expect(mutations(calls)).toEqual([]);
});
