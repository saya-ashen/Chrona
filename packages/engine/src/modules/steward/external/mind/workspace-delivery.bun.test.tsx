import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { DeliveryRecord } from './core-delivery';
import type { MindContext } from './workspace-ui';

const window = new Window({ url: 'http://localhost/mind-delivery-test' });
const previous = new Map<string, PropertyDescriptor | undefined>();
let mount: typeof import('./workspace-ui').default;
let lifecycle: ReturnType<typeof mount> | undefined;
let container: HTMLElement;
const originalError = console.error;
const envelope = (value: unknown) => ({ json: JSON.stringify(value) });
const author = { moduleId: 'author-real', hash: 'a'.repeat(40) };
const materialDigest = 'b'.repeat(64);
function prepared(id = 'delivery-001'): DeliveryRecord {
    const payload = { pursuitId: 'pursuit-original', expectedRevision: 3, expectedVisibilityRevision: 7, actionKey: 'worker-handoff-original', author, admissionId: 'admission-original', requestKey: 'request-original', items: [{ name: 'timetable', dir: 'packages/timetable/source', intent: { changes: ['读取公共时刻表'], preserves: ['保留用户原有提醒'] }, materialDigest }], criteria: ['实际查到下一班车并核验'] };
    return structuredClone({ id, pursuitId: payload.pursuitId, revision: 3, visibilityRevision: 7, actionKey: payload.actionKey, author, admissionId: payload.admissionId, requestKey: payload.requestKey, worker: { executionId: 'execution-real', runId: 'run-real', actor: 'worker-real', principal: { moduleId: 'mind-real', hash: 'c'.repeat(40) } }, commandDigest: 'd'.repeat(64), prepareDigest: 'e'.repeat(64), pursuitBasis: 'f'.repeat(64), materials: [{ name: 'timetable', materialDigest }], payload, proof: [{ name: 'timetable', callId: 'stage-call-real', materialDigest }], status: 'coordinator-ready', withdrawn: false, receipt: null, observation: 'awaiting exact review', directory: [], cleanup: '', updatedAt: '2026-11-14T00:00:00Z' });
}
function submitted(original = prepared()): DeliveryRecord {
    return { ...structuredClone(original), status: 'submitted', receipt: { receiptId: 'receipt-original', admissionId: original.admissionId, requestKey: original.requestKey, submitter: original.author, state: 'pending_approval', approvalId: 'approval-original', members: [{ name: 'timetable', moduleId: 'timetable-real', hash: '1'.repeat(40), versionId: 'version-original', expectedActiveHash: null, materialDigest, status: 'pending_review', selected: false }] } };
}
const summary = (r: DeliveryRecord) => ({ id: r.id, pursuitId: r.pursuitId, status: r.status, withdrawn: r.withdrawn, observation: r.observation, cleanup: r.cleanup });
const visible = () => container.textContent ?? '';
const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
function button(name: string) { const b = buttons().find(b => b.textContent?.trim() === name); if (!b) throw Error(`Missing ${name}: ${visible()}`); return b; }
async function wait(condition: () => boolean) { for (let i = 0; i < 240; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 5)); } throw Error(`DOM timeout: ${visible()}`); }
async function click(name: string) { button(name).click(); await new Promise(r => setTimeout(r, 8)); }
async function confirm() { container.querySelector<HTMLInputElement>('.mind-delivery-confirm input[type=checkbox]')!.click(); await new Promise(r => setTimeout(r, 8)); }
type Input = { operation: string; id?: string; after?: string; limit?: number };
type Recorded = { tool: string; args: Record<string, any> };
async function start(delivery: (input: Input) => unknown | Promise<unknown>, pursuits: unknown[] = []) {
    const calls: Recorded[] = [];
    container = window.document.createElement('div') as unknown as HTMLElement; window.document.body.append(container as any);
    const call: MindContext['call'] = async (tool, args) => {
        calls.push({ tool, args: structuredClone(args) });
        if (tool === 'overview') return envelope({ items: pursuits, visibilityRevision: 7, settings: { learningEnabled: true } });
        if (tool === 'context') return envelope({ understandings: [] });
        if (tool === 'applications') return envelope([]);
        if (tool === 'delivery') return delivery(JSON.parse(args.input));
        throw Error('Unexpected tool: ' + tool);
    };
    lifecycle = mount(container, { call, props: { view: 'improvements' } });
    await wait(() => calls.some(c => c.tool === 'delivery')); return calls;
}
const effects = (calls: Recorded[]) => calls.filter(c => c.tool === 'delivery' && ['submit', 'withdraw', 'reconcile'].includes(JSON.parse(c.args.input).operation));
async function open(id = 'delivery-001') { container.querySelector<HTMLButtonElement>(`[aria-label="审阅交付 ${id}"]`)!.click(); await wait(() => visible().includes('Author 应用与精确版本')); }
async function submitReview() { await open(); await click('审阅后提交此材料'); expect(button('确认提交精确材料').disabled).toBe(true); await confirm(); await click('确认提交精确材料'); }
beforeAll(async () => {
    for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'navigator', 'Event', 'MouseEvent', 'KeyboardEvent']) {
        previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'window' ? window : (window as any)[key] });
    }
    console.error = () => undefined; mount = (await import('./workspace-ui')).default;
});
afterEach(() => { lifecycle?.destroy(); lifecycle = undefined; window.document.body.replaceChildren(); });
afterAll(async () => { await new Promise(r => setTimeout(r, 25)); await window.happyDOM.abort(); console.error = originalError; for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; } });

test('loading, empty, list error and pagination use the actual owner wire', async () => {
    let release!: (v: unknown) => void;
    let mode = 'loading';
    const calls = await start(p => mode === 'loading' ? new Promise(r => { release = r; }) : mode === 'error' ? Promise.reject(Error('交付目录读取失败')) : envelope({ items: p.after ? [summary(prepared('delivery-002'))] : [summary(prepared())], nextCursor: p.after ? null : 'delivery-001' }));
    expect(visible()).toContain('正在读取交付记录'); expect(visible()).not.toContain('尚无待审阅的能力交付');
    release(envelope({ items: [], nextCursor: null })); await wait(() => visible().includes('尚无待审阅的能力交付'));
    mode = 'error'; await click('重新读取交付列表'); await wait(() => visible().includes('交付目录读取失败')); expect(visible()).not.toContain('尚无待审阅的能力交付');
    mode = 'pages'; await click('重新读取交付列表'); await wait(() => !!container.querySelector('[aria-label="审阅交付 delivery-001"]')); await click('加载更多交付'); await wait(() => !!container.querySelector('[aria-label="审阅交付 delivery-002"]'));
    expect(calls.filter(c => c.tool === 'delivery').at(-1)?.args).toEqual({ input: JSON.stringify({ operation: 'list', limit: 20, after: 'delivery-001' }) }); expect(effects(calls)).toEqual([]);
});

for (const [status, label] of [['failed', '提交失败'], ['rejected', '交付已被拒绝']] as const) {
    test(`${status} delivery summaries show a meaningful Chinese status`, async () => {
        const record: DeliveryRecord = { ...prepared(), status };
        const calls = await start(() => envelope({ items: [summary(record)], nextCursor: null }));
        await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`));
        const row = container.querySelector(`[aria-label="审阅交付 ${record.id}"]`)!.closest('article')!;
        expect(row.textContent).toContain(label);
        expect(effects(calls)).toEqual([]);
    });
}

function rejected(original = prepared()): DeliveryRecord {
    const record = submitted(original);
    record.status = 'rejected';
    record.receipt!.state = 'rejected';
    record.receipt!.members[0]!.status = 'rejected';
    return record;
}

test('rejected detail renders the original receipt and reconciles without offering submission', async () => {
    const record = rejected();
    const calls = await start(p => envelope(p.operation === 'list' ? { items: [summary(record)], nextCursor: null } : record));
    await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`));
    await open();
    expect(visible()).toContain('交付已被拒绝');
    expect(visible()).toContain('receipt-original');
    expect(visible()).toContain('已拒绝');
    expect(buttons().some(b => b.textContent?.includes('审阅后提交'))).toBe(false);
    expect(effects(calls)).toEqual([]);
    await click('查询原提交回执');
    await wait(() => visible().includes('已核对交付记录；状态以原回执为准'));
    expect(effects(calls).map(c => JSON.parse(c.args.input))).toEqual([{ operation: 'reconcile', id: record.id }]);
});

test('an immediate rejected submit receipt resolves the same request', async () => {
    const original = prepared();
    const calls = await start(p => envelope(p.operation === 'list' ? { items: [summary(original)], nextCursor: null } : p.operation === 'detail' ? original : rejected(original)));
    await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${original.id}"]`));
    await submitReview();
    await wait(() => visible().includes('receipt-original'));
    expect(visible()).toContain('交付已被拒绝');
    expect(visible()).not.toContain('原提交的结果尚不确定');
    expect(effects(calls).map(c => JSON.parse(c.args.input).operation)).toEqual(['submit']);
});

for (const mismatch of ['rejected-without-receipt', 'rejected-pending-receipt', 'submitted-rejected-receipt', 'failed-with-receipt'] as const) {
    test(`detail refuses inconsistent terminal status ${mismatch}`, async () => {
        const record = rejected();
        if (mismatch === 'rejected-without-receipt') record.receipt = null;
        if (mismatch === 'rejected-pending-receipt') record.receipt!.state = 'pending_approval';
        if (mismatch === 'submitted-rejected-receipt') record.status = 'submitted';
        if (mismatch === 'failed-with-receipt') record.status = 'failed';
        const calls = await start(p => envelope(p.operation === 'list' ? { items: [summary(record)], nextCursor: null } : record));
        await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`));
        container.querySelector<HTMLButtonElement>(`[aria-label="审阅交付 ${record.id}"]`)!.click();
        await wait(() => visible().includes('交付记录或回执身份无效'));
        expect(visible()).not.toContain('receipt-original');
        expect(effects(calls)).toEqual([]);
    });
}

test('manual submit reviews frozen actual detail and sends only operation plus original id', async () => {
    let record = prepared();
    const calls = await start(p => envelope(p.operation === 'list' ? { items: [summary(record)], nextCursor: null } : p.operation === 'submit' ? (record = submitted(record)) : record));
    await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`)); await open();
    const review = container.querySelector('[aria-label="交付材料与回执"]')!.textContent!;
    for (const exact of [author.moduleId, author.hash, materialDigest, 'pursuit-original', 'packages/timetable/source', '读取公共时刻表', '保留用户原有提醒', '实际查到下一班车并核验', 'timetable']) expect(review).toContain(exact);
    await click('审阅后提交此材料'); expect(effects(calls)).toEqual([]); button('确认提交精确材料').click(); expect(effects(calls)).toEqual([]);
    await confirm(); await click('确认提交精确材料'); await wait(() => visible().includes('receipt-original'));
    expect(effects(calls)).toEqual([{ tool: 'delivery', args: { input: JSON.stringify({ operation: 'submit', id: 'delivery-001' }) } }]);
    expect(visible()).toContain('启用后仍须核对实际效果'); expect(buttons().some(b => b.textContent?.includes('确认提交精确材料'))).toBe(false);
});

test('a thrown submit switches the global pending request to reconcile, never resubmits or allocates a key', async () => {
    let record = prepared(), attempts = 0;
    const calls = await start(p => { if (p.operation === 'list') return envelope({ items: [summary(record)], nextCursor: null }); if (p.operation === 'submit') { record = { ...record, status: 'submit-unknown' }; throw Error('连接中断，提交可能已发生'); } if (p.operation === 'reconcile') { if (++attempts === 1) throw Error('原回执暂不可读'); record = submitted(record); } return envelope(record); });
    await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`)); await submitReview(); await wait(() => visible().includes('原提交的结果尚不确定'));
    expect(buttons().some(b => b.textContent?.trim() === '重试原请求')).toBe(false); await click('查询原提交回执'); await wait(() => visible().includes('原回执暂不可读'));
    await click('查询原提交回执'); await wait(() => visible().includes('receipt-original'));
    expect(effects(calls).map(c => JSON.parse(c.args.input))).toEqual([{ operation: 'submit', id: record.id }, { operation: 'reconcile', id: record.id }, { operation: 'reconcile', id: record.id }]); expect(visible()).not.toContain('原提交的结果尚不确定');
});

test('loaded unknown records offer reconcile only and exact activation still awaits original goal proof', async () => {
    let record: DeliveryRecord = { ...prepared(), status: 'submit-unknown' };
    const calls = await start(p => { if (p.operation === 'list') return envelope({ items: [summary(record)], nextCursor: null }); if (p.operation === 'reconcile') { record = submitted(record); record.receipt!.members[0]!.selected = true; record.receipt!.members[0]!.status = 'approved'; record.receipt!.state = 'approved'; record.directory = [{ id: 'timetable-real', name: 'timetable', status: 'active', activeHash: '1'.repeat(40) }]; } return envelope(record); });
    await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`)); await open(); expect(buttons().some(b => b.textContent?.includes('审阅后提交'))).toBe(false);
    await click('查询原提交回执'); await wait(() => visible().includes('精确版本已激活；原目标仍待核验'));
    expect(effects(calls).map(c => JSON.parse(c.args.input))).toEqual([{ operation: 'reconcile', id: record.id }]);
});

test('withdrawal scrubs reviewed source and leaves unknown reconciliation with honest deferred cleanup', async () => {
    let record: DeliveryRecord = { ...prepared(), status: 'submit-unknown' };
    const calls = await start(p => { if (p.operation === 'list') return envelope({ items: [summary(record)], nextCursor: null }); if (p.operation === 'withdraw') record = { ...record, withdrawn: true, payload: null, cleanup: 'deferred: original call arguments remain in flight' }; if (p.operation === 'reconcile') record = submitted(record); return envelope(record); });
    await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`)); await open(); await click('撤回交付材料'); expect(button('确认撤回交付').disabled).toBe(true); await confirm(); await click('确认撤回交付');
    await wait(() => visible().includes('源码路径、改动意图和验收条件已撤回')); expect(visible()).not.toContain('packages/timetable/source'); expect(visible()).not.toContain('实际查到下一班车并核验'); expect(visible()).toContain('清理仍待完成'); expect(visible()).toContain('原提交仍未知');
    await click('查询原提交回执'); await wait(() => visible().includes('receipt-original')); expect(visible()).not.toContain('packages/timetable/source');
    expect(effects(calls).map(c => JSON.parse(c.args.input))).toEqual([{ operation: 'withdraw', id: record.id }, { operation: 'reconcile', id: record.id }]);
});

test('late detail versions cannot replace a newer selection or retain prior confirmation', async () => {
    const a = prepared(), b = prepared('delivery-002'); b.author.hash = '2'.repeat(40); b.payload!.author.hash = b.author.hash;
    let release!: (v: unknown) => void;
    const calls = await start(p => p.operation === 'list' ? envelope({ items: [summary(a), summary(b)], nextCursor: null }) : p.id === a.id ? new Promise(r => { release = r; }) : envelope(b));
    await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${b.id}"]`)); container.querySelector<HTMLButtonElement>(`[aria-label="审阅交付 ${a.id}"]`)!.click(); await wait(() => !!release); await open(b.id);
    release(envelope(a)); await new Promise(r => setTimeout(r, 20)); const detail = container.querySelector('[aria-label="交付材料与回执"]')!.textContent!; expect(detail).toContain(b.author.hash); expect(detail).not.toContain(a.author.hash);
    await click('审阅后提交此材料'); expect(button('确认提交精确材料').disabled).toBe(true); expect(effects(calls)).toEqual([]);
});

test('malformed details and mismatched identities cannot enter material review', async () => {
    const record = prepared();
    let response: any = { ...record, id: 'other-delivery' };
    const calls = await start(p => envelope(p.operation === 'list' ? { items: [summary(record)], nextCursor: null } : response));
    await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`)); container.querySelector<HTMLButtonElement>(`[aria-label="审阅交付 ${record.id}"]`)!.click(); await wait(() => visible().includes('交付详情与所选事项不一致'));
    response = { ...record, status: 'unexpected-status' }; await click('重新读取此交付'); await wait(() => visible().includes('交付记录或回执身份无效'));
    expect(buttons().some(b => b.textContent?.includes('审阅后提交'))).toBe(false); expect(effects(calls)).toEqual([]);
});

for (const corrupt of ['id', 'requestKey', 'materialDigest', 'status', 'author', 'memberHash', 'receiptId'] as const) {
    test(`invalid submit result ${corrupt} stays uncertain; receipt identity is verified before success`, async () => {
        const original = corrupt === 'receiptId' ? submitted() : prepared();
        const bad = submitted(original);
        if (corrupt === 'id') bad.id = 'unrelated';
        if (corrupt === 'requestKey') bad.receipt!.requestKey = 'different-request';
        if (corrupt === 'materialDigest') bad.receipt!.members[0]!.materialDigest = '9'.repeat(64);
        if (corrupt === 'status') bad.status = 'coordinator-ready';
        if (corrupt === 'author') bad.receipt!.submitter = { ...author, hash: '9'.repeat(40) };
        if (corrupt === 'memberHash') bad.receipt!.members[0]!.hash = 'not-a-hash';
        if (corrupt === 'receiptId') bad.receipt!.receiptId = 'different-receipt';
        const calls = await start(p => envelope(p.operation === 'list' ? { items: [summary(original)], nextCursor: null } : p.operation === 'detail' ? original : bad));
        await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${original.id}"]`));
        if (corrupt === 'receiptId') { await open(); await click('查询原提交回执'); } else await submitReview();
        await wait(() => visible().includes('上一请求的结果尚不确定') || visible().includes('原提交的结果尚不确定'));
        expect(visible()).not.toContain('已核对交付记录；状态以原回执为准'); expect(effects(calls)).toHaveLength(1);
    });
}

test('unknown local submit can be withdrawn even while the original receipt is unavailable', async () => {
    let record = prepared();
    const calls = await start(p => {
        if (p.operation === 'list') return envelope({ items: [summary(record)], nextCursor: null });
        if (p.operation === 'submit') { record = { ...record, status: 'submit-unknown' }; throw Error('提交中断'); }
        if (p.operation === 'reconcile') throw Error('原回执尚不可读');
        if (p.operation === 'withdraw') record = { ...record, withdrawn: true, payload: null, cleanup: 'deferred: original call arguments remain in flight' };
        return envelope(record);
    });
    await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`)); await submitReview(); await wait(() => visible().includes('原提交的结果尚不确定'));
    await click('查询原提交回执'); await wait(() => visible().includes('原回执尚不可读'));
    expect(button('撤回交付材料').disabled).toBe(false); await click('撤回交付材料'); await confirm(); await click('确认撤回交付');
    await wait(() => visible().includes('源码路径、改动意图和验收条件已撤回')); expect(visible()).toContain('原提交仍未知'); expect(visible()).toContain('清理仍待完成'); expect(visible()).not.toContain('packages/timetable/source');
    expect(button('查询原提交回执').disabled).toBe(false);
    expect(effects(calls).map(c => JSON.parse(c.args.input).operation)).toEqual(['submit', 'reconcile', 'withdraw']);
});

test('loaded unknown query failure also permits same-id withdrawal without granting another submit', async () => {
    let record: DeliveryRecord = { ...prepared(), status: 'submit-unknown' };
    const calls = await start(p => {
        if (p.operation === 'list') return envelope({ items: [summary(record)], nextCursor: null });
        if (p.operation === 'reconcile') throw Error('回执离线');
        if (p.operation === 'withdraw') record = { ...record, withdrawn: true, payload: null };
        return envelope(record);
    });
    await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`)); await open(); await click('查询原提交回执'); await wait(() => visible().includes('回执离线'));
    await click('撤回交付材料'); await confirm(); await click('确认撤回交付'); await wait(() => visible().includes('源码路径、改动意图和验收条件已撤回'));
    expect(effects(calls).map(c => JSON.parse(c.args.input).operation)).toEqual(['reconcile', 'withdraw']);
});

test('withdraw result must preserve an unknown original command until an exact receipt resolves it', async () => {
    const record: DeliveryRecord = { ...prepared(), status: 'submit-unknown' };
    const calls = await start(p => envelope(p.operation === 'list' ? { items: [summary(record)], nextCursor: null } : p.operation === 'withdraw' ? { ...record, withdrawn: true, payload: null, status: 'withdrawn' } : record));
    await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`)); await open(); await click('撤回交付材料'); await confirm(); await click('确认撤回交付');
    await wait(() => visible().includes('原提交仍未知，必须保留同一回执的核对入口'));
    expect(visible()).not.toContain('已核对交付记录；状态以原回执为准'); expect(effects(calls)).toHaveLength(1);
});

test('generic compacted outcome envelope cannot skip the delivery receipt callback or unlock another submit', async () => {
    const record = prepared();
    const calls = await start(p => envelope(p.operation === 'list' ? { items: [summary(record)], nextCursor: null } : p.operation === 'detail' ? record : { ...submitted(record), outcome: 'compacted' }));
    await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`)); await submitReview(); await wait(() => visible().includes('原提交的结果尚不确定'));
    expect(buttons().some(b => b.textContent?.trim() === '确认提交精确材料')).toBe(false); expect(effects(calls)).toHaveLength(1); expect(visible()).not.toContain('原请求已有回执，但相关内容已清理或压缩');
});

for (const status of ['coordinator-ready', 'failed', 'rejected'] as const) {
    test(`${status} delivery keeps its task title and expandable identity`, async () => {
        const goal = `改进 应用中心：改善应用列表的布局与操作\n反馈对应版本：${'a'.repeat(40)}；应用：a72dc177-cd15-47fa-9335-18e2ec58e4c2`;
        const title = '改进 应用中心：改善应用列表的布局与操作';
        const record = status === 'rejected' ? rejected() : { ...prepared(), status };
        const calls = await start(p => envelope(p.operation === 'list' ? { items: [summary(record)], nextCursor: null } : record), [{ id: record.pursuitId, goal, status: 'waiting', waitFor: 'user' }]);
        await wait(() => !!container.querySelector(`[aria-label="审阅交付 ${record.id}"]`));
        const card = container.querySelector(`[aria-label="审阅交付 ${record.id}"]`)!.closest('article')!;
        expect(card.querySelector('h4')?.textContent).toBe(title);
        const technical = card.querySelector('details')!;
        expect(technical.open).toBe(false);
        technical.querySelector('summary')!.click();
        expect(technical.open).toBe(true);
        expect(technical.textContent).toContain(record.id);
        expect(technical.textContent).toContain(record.pursuitId);
        await open();
        expect(container.querySelector('.mind-delivery-review h4')?.textContent).toBe(`${title} · 改动与检查`);
        const details = container.querySelector<HTMLDetailsElement>('.mind-delivery-review details')!;
        expect(details.open).toBe(false);
        expect(details.textContent).toContain(record.worker.runId);
        expect(details.textContent).toContain(record.requestKey);
        expect(effects(calls)).toEqual([]);
    });
}
