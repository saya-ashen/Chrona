import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreMindService } from "./core-service";
import { CoreMindStore, evidenceId } from "./core-store";
import type { CoreAccess, ContextResult, Scope, Understanding } from "./core-types";

const owner: CoreAccess = { subject: "owner", role: "owner", scopes: [{}] };
const runtime: CoreAccess = { subject: "source-adapter", role: "runtime", scopes: [{}] };
const at = "2026-11-13T12:00:00.000Z";
const resources: Array<{ store: CoreMindStore; directory: string }> = [];
afterEach(() => {
  for (const { store, directory } of resources.splice(0)) {
    store.close(); rmSync(directory, { recursive: true, force: true });
  }
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "mind-context-"));
  const store = new CoreMindStore(directory);
  resources.push({ store, directory });
  let sequence = 0;
  const service = new CoreMindService(store, { now: () => new Date(Date.parse(at) + sequence++ * 1000).toISOString() });
  const visibility = () => store.inspect(tx => tx.meta().visibilityRevision);
  function source(text: string, scope: Scope = {}) {
    const id = `message-${sequence++}`;
    const checkpoint = store.inspect(tx => tx.get("checkpoint", "chat"));
    service.ingest({ sourceIdentity: "chat", epoch: "one", expectedCheckpointRevision: checkpoint?.revision ?? 0,
      nextCursor: id, scopeRevision: 1, capturedAt: at, coverage: { complete: true }, events: [{
        id, eventId: id, cursor: id, object: { kind: "message", id, revision: 1 }, kind: "message", scope,
        actor: "user", origin: { rootId: id }, occurredAt: at, receivedAt: at, scopeRevision: 1,
        content: { text, truncated: false },
      }] }, runtime);
    return evidenceId("chat", "one", id);
  }
  function remember(value: string, options: { scope?: Scope; kind?: Understanding["kind"]; source?: string; inferred?: boolean } = {}) {
    const scope = options.scope ?? {};
    return service.remember({ actionKey: `memory-${sequence++}`, expectedVisibilityRevision: visibility(), expectedRevision: 0,
      kind: options.kind ?? "preference", value, scope, explicitness: options.inferred ? "inferred" : "explicit",
      supportingRefs: options.source || options.inferred ? [source(options.source ?? value, scope)] : [],
    }, owner).value!;
  }
  function pursue(goal: string, original: string) {
    return service.pursue({ actionKey: `pursue-${sequence++}`, expectedVisibilityRevision: visibility(), expectedRevision: 0,
      semanticKey: `goal-${sequence}`, goal, completionCriteria: ["用户能使用实际结果"], scope: {}, reason: "explicit-goal",
      evidenceRefs: [source(original)],
    }, owner).value!;
  }
  return { store, service, source, remember, pursue, visibility };
}
const unrelated = ["编辑器使用深色主题", "旅行优先乘坐高铁", "阅读喜欢纸质书籍", "周末喜欢参观博物馆", "工作邮件使用简短标题",
  "跑步喜欢沿河路线", "手机通知关闭声音", "购物时优先可维修产品", "洗衣使用无香洗涤剂", "音乐播放使用随机顺序",
  "文档使用等宽字体", "照片按地点分类", "会议记录保存为纯文本", "键盘使用英文布局", "卧室窗帘使用浅色", "学习资料保留原文"];
function distract(remember: ReturnType<typeof setup>["remember"]) { unrelated.forEach(value => remember(value)); }
function ids(context: ContextResult) { return [...context.understandings, ...context.pursuits].map(item => item.id); }

test("original conversation sees its durable blocker without Notify, unrelated goals or withdrawn evidence", () => {
  const { service, store, pursue, visibility } = setup();
  const first = pursue("交付应用中心", "请完成应用中心并给出候选回执" + "x".repeat(16_000));
  pursue("其他会话的私人目标", "unrelated-private-marker");
  const root = service.detail({kind:"evidence",id:first.evidenceRefs[0]!},owner).origin.rootId;
  store.update(tx => { const p = tx.get("pursuit",first.id)!; p.status="waiting"; p.waitReason="公开接口缺少精确 Git 版本材料交接"; p.nextStep="由当前任务负责人补齐接口后继续"; tx.put("pursuit",p); });
  expect(store.read().settings.notifyEnabled).toBe(false);
  const result = service.conversationUpdates("chat",root,owner,{epoch:"one",scopeRevision:1});
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({id:first.id,status:"waiting",waitReason:"公开接口缺少精确 Git 版本材料交接",nextStep:"由当前任务负责人补齐接口后继续"});
  expect(JSON.stringify(result)).not.toContain("unrelated-private-marker");
  expect(service.conversationUpdates("chat",root,owner,{epoch:"restored",scopeRevision:1}).items).toEqual([]);
  expect(service.conversationUpdates("other-chat",root,owner,{epoch:"one",scopeRevision:1}).items).toEqual([]);
  expect(service.conversationUpdates("chat","another-root",owner,{epoch:"one",scopeRevision:1}).items).toEqual([]);
  service.forget({actionKey:"withdraw-original",expectedVisibilityRevision:visibility(),target:{kind:"evidence",id:first.evidenceRefs[0]!}},owner);
  expect(service.conversationUpdates("chat",root,owner,{epoch:"one",scopeRevision:1}).items).toEqual([]);
});

describe("bounded local Mind context recall", () => {
  test("older Chinese dietary preference survives sixteen newer unrelated preferences without a food routing table", () => {
    const { service, remember } = setup();
    const vegetarian = remember("长期遵循素食饮食习惯", { source: "我平时都吃素，点餐时请一直按这个偏好来。" });
    distract(remember);
    const result = service.context({ query: "帮我安排今晚吃什么", scope: {}, limit: 8 }, owner);
    expect(result.understandings[0]!.id).toBe(vegetarian.id);
    expect(ids(result)).toHaveLength(8);
    expect(result.truncated).toBe(true);
    expect(result.evidence.some(e => vegetarian.supportingRefs.includes(e.id))).toBe(true);
    // Literal overlap in the stored memory also works when the query has no spaces.
    expect(ids(service.context({ query: "今天想吃素菜", scope: {}, limit: 8 }, owner))).toContain(vegetarian.id);
  });

  test("CJK character overlap crosses segmentation boundaries and punctuation", () => {
    const { service, remember } = setup();
    const target = remember("希望票据归档自动化", { kind: "goal" });
    distract(remember);
    expect(ids(service.context({ query: "把票据按月整理归档吧！", scope: {}, limit: 1 }, owner))).toEqual([target.id]);
  });

  test("original source wording recalls the same ongoing goal before unrelated preferences fill the budget", () => {
    const { service, remember, pursue } = setup();
    const target = pursue("完成财务材料的本地整理", "请把发票按照月份归档，处理完给我能打开的文件。");
    distract(remember);
    const result = service.context({ query: "上次说的发票归档进展如何", scope: {}, limit: 1 }, owner);
    expect(ids(result)).toEqual([target.id]);
    expect(result.pursuits[0]!.goal).toBe(target.goal);
    expect(result.evidence.map(e => e.id)).toEqual(target.evidenceRefs);
  });

  test("Latin word boundaries, Unicode normalization and repeated words do not inflate an unrelated match", () => {
    const { service, remember } = setup();
    const target = remember("Archive receipts offline using SQLite");
    remember("My SQLAlchemy examples are online");
    const fallback = remember("archive ".repeat(60));
    expect(ids(service.context({ query: "ＳＱＬｉｔｅ receipts archive", scope: {}, limit: 1 }, owner))).toEqual([target.id]);
    expect(ids(service.context({ query: "sql", scope: {}, limit: 1 }, owner))).toEqual([fallback.id]);
  });

  test("unmatched memories remain available and empty queries retain deterministic scoped fallback", () => {
    const { service, remember } = setup();
    const global = remember("我喜欢轻量背包");
    const local = remember("这次需要大箱子", { scope: { sessionId: "trip" } });
    const input = { query: "完全不同的话题", scope: { sessionId: "trip" }, limit: 2 };
    expect(ids(service.context(input, owner))).toEqual([local.id, global.id]);
    expect(service.context(input, owner)).toEqual(service.context(input, owner));
    expect(ids(service.context({ ...input, query: "" }, owner))).toEqual([local.id, global.id]);
  });

  test("explicit corrections and this-session exceptions precede inferred or broader claims", () => {
    const { service, remember, visibility } = setup();
    const broad = remember("资料默认保存在本地", { kind: "constraint" });
    const local = remember("这次允许云端共享", { kind: "constraint", scope: { projectId: "p", sessionId: "s" } });
    const corrected = service.control({ actionKey: "correct-local", expectedVisibilityRevision: visibility(), expectedRevision: local.revision,
      kind: "understanding", id: local.id, operation: "correct", value: "这次也只允许本地保存" }, owner).value!;
    remember("本地保存似乎可以同步到云端", { inferred: true, scope: { projectId: "p", sessionId: "s" } });
    const input = { query: "云端共享", scope: { projectId: "p", sessionId: "s" }, limit: 1 };
    const result = service.context(input, owner);
    expect(ids(result)).toEqual([corrected.id]);
    expect(JSON.stringify(result)).not.toContain("这次允许云端共享");
    expect(ids(service.context({ ...input, scope: { projectId: "p", sessionId: "other" } }, owner))).toEqual([broad.id]);
    const caller: CoreAccess = { subject: "chat", role: "application", scopes: [{ projectId: "p", sessionId: "other" }] };
    expect(() => service.context(input, caller)).toThrow("scope");
  });

  test("incomplete coverage cannot rank or expose copied understanding, and forgetting removes the recall path", () => {
    const { store, service, remember, visibility } = setup();
    const target = remember("长期遵循素食饮食习惯", { source: "我平时都吃素。" });
    const input = { query: "今晚吃什么", scope: {}, limit: 8 };
    expect(ids(service.context(input, owner))).toContain(target.id);
    const checkpoint = store.inspect(tx => tx.get("checkpoint", "chat"))!;
    service.ingest({ sourceIdentity: "chat", epoch: "one", expectedCheckpointRevision: checkpoint.revision, nextCursor: "gap",
      scopeRevision: 1, capturedAt: at, coverage: { complete: false, gap: "source unavailable" }, events: [] }, runtime);
    const gap = service.context(input, owner);
    expect(ids(gap)).toEqual([]);
    expect(gap.evidence).toEqual([]);
    expect(gap.unknowns).toContain("chat: source unavailable");
    service.ingest({ sourceIdentity: "chat", epoch: "one", expectedCheckpointRevision: checkpoint.revision + 1, nextCursor: "recovered",
      scopeRevision: 1, capturedAt: at, coverage: { complete: true }, events: [] }, runtime);
    expect(ids(service.context(input, owner))).toContain(target.id);
    service.forget({ actionKey: "forget", expectedVisibilityRevision: visibility(), target: { kind: "understanding", id: target.id } }, owner);
    const forgotten = service.context(input, owner);
    expect(ids(forgotten)).toEqual([]);
    expect(forgotten.evidence).toEqual([]);
    expect(JSON.stringify(forgotten)).not.toContain("素食");
  });

  test("byte limits, count limits and complete evidence bundles hold for multibyte text", () => {
    const { service, remember } = setup();
    remember("归档".repeat(1000));
    const small = remember("归档需要保留原文");
    for (const maxBytes of [512, 2048, 4096, 16384, 32768]) {
      const result = service.context({ query: "归档", scope: {}, limit: 1, maxBytes }, owner);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(maxBytes);
      expect(ids(result).length).toBeLessThanOrEqual(1);
      for (const u of result.understandings) {
        expect(u.supportingRefs.every(ref => result.evidence.some(e => e.id === ref))).toBe(true);
      }
    }
    expect(ids(service.context({ query: "归档", scope: {}, limit: 1, maxBytes: 2048 }, owner))).toEqual([small.id]);
    expect(() => service.context({ query: "字".repeat(3000), scope: {} }, owner)).toThrow("8192");
  });

  test("context stays synchronous and read-only with a bounded local latency and no Agent dependency", () => {
    const { store, service, remember } = setup();
    const target = remember("票据需要本地归档");
    for (let i = 0; i < 100; i++) remember(`编辑器主题编号 ${i}`);
    const before = store.inspect(tx => tx.meta());
    const started = performance.now();
    for (let i = 0; i < 20; i++) {
      const result = service.context({ query: "票据怎么归档", scope: {}, limit: 8 }, owner);
      expect(ids(result)).toContain(target.id);
      expect(result).not.toBeInstanceOf(Promise);
    }
    expect(performance.now() - started).toBeLessThan(1500);
    expect(store.inspect(tx => tx.meta())).toEqual(before);
  });
});
