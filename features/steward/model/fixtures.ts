import { affairDetailSchema, affairSchema, askSchema, todayViewSchema, chatReplySchema } from "@chrona/contracts";

export function affairFixture() {
  return affairSchema.parse({ id: "camera", title: "二手相机选购", goal: "旅行用，预算 6000 元", summary: "已加入富士比较", nextStep: "更新成果", status: "active", agentState: "waiting_user", handling: { mode: "result_page", rationale: "需要比较多款机型并保留来源" }, care: null, openAsks: 1, ref: null, latestResult: { version: 2, title: "相机结论", createdAt: fixtureTime }, lastError: null, createdAt: fixtureTime, updatedAt: fixtureTime, lastActivityAt: fixtureTime });
}
export function detailFixture() {
  return affairDetailSchema.parse({ affair: affairFixture(), asks: [questionFixture()], latestResult: { id: "result-2", affairId: "camera", version: 2, title: "相机结论", summary: "优先考虑轻便机型", body: "## 比较\n\n富士更轻。", sources: [{ title: "评测", url: "https://example.com/review", verified: true, note: "" }, { title: "成交价", url: "https://example.com/prices", verified: false, note: "未验机" }], limitations: "镜头成本未计入", nextSteps: ["比较镜头"], createdAt: fixtureTime }, resultVersions: [1, 2].map(version => ({ version, title: "相机结论", createdAt: fixtureTime })), entries: [{ id: "entry-1", affairId: "camera", at: fixtureTime, actor: "user", kind: "request", text: "看看富士", data: null }], followUps: [], tools: [], grants: [], runs: [], events: [] });
}
export const fixtureTime = "2026-10-15T10:42:00+08:00";
export function questionFixture() {
  return askSchema.parse({ id: "weight", affairId: "camera", affairTitle: "二手相机选购", kind: "question", status: "open", title: "需要补充：最多能接受多重的机身？", detail: "旅行用，重量会直接排除 A7 IV 和 X-T5 中的一个。", questions: [{ question: "最多能接受多重的机身？", why: "旅行用" }], action: null, topic: null, answer: null, decision: null, cooldownUntil: null, ref: null, createdAt: fixtureTime, resolvedAt: null });
}
export function emptyToday() {
  return todayViewSchema.parse({ generatedAt: fixtureTime, counts: { active: 0, watching: 0, waiting: 0, newResults: 0 }, decisions: [], changes: [], results: [], upcoming: [], suggestions: [], health: { sandbox: { available: false, languages: [] }, agent: { available: true, name: "Pi", lastError: null }, queuedAffairs: 0, runningAffairs: 0, failedAffairs: 0, pendingEvents: 0, failingConnections: 0, queuedNotifications: 0, failedNotifications: 0, lastTickAt: fixtureTime } });
}
export function todayFixture() {
  return todayViewSchema.parse({ ...emptyToday(), counts: { active: 4, watching: 3, waiting: 2, newResults: 1 }, decisions: [questionFixture(), { ...questionFixture(), id: "script", affairId: "chino", affairTitle: "Chino 服务照看", kind: "approval", title: "想运行脚本：每周汇总 Chino 服务的不可用时长", detail: "脚本只读仪表盘历史，在沙箱里运行，不联网。第一次运行需要你同意。", questions: [], action: "run_script" }], changes: [{ id: "recovered", affairId: "chino", affairTitle: "Chino 服务照看", at: fixtureTime, actor: "source", kind: "change", text: "Jellyfin 恢复正常", data: null }], results: [{ id: "camera-v2", affairId: "camera", affairTitle: "二手相机选购", version: 2, title: "二手相机选购结论", summary: "在 5000 元内，二手 A7 III 性价比最高；X-S10 更轻但续航短。附 6 个来源。", createdAt: fixtureTime }], upcoming: [{ kind: "follow_up", affairId: "domain", affairTitle: "域名与证书", note: "续费 saya.love 域名", at: "2026-10-16T09:00:00+08:00" }], suggestions: [{ ...questionFixture(), id: "currency", affairId: null, affairTitle: null, kind: "suggestion", title: "你这个月查了 3 次日元汇率，要不要做个汇率面板？", detail: "面板会显示近 30 天走势和你设的提醒线，打开网页就能看。", questions: [], topic: "currency-panel" }] });
}
export const chatFixture = chatReplySchema.parse({ reply: "好，我把预算改成 6000 并加上富士，重新比较后会更新成果。", affairId: "camera", effects: [{ kind: "supplement", affairId: "camera", label: "已补充到「二手相机选购」" }] });
