type Args = Record<string, unknown>;
type Notice = { title: string; body: string; level: "now" | "digest" };
const notices: Record<string, (facts: Args, app: string, error: string) => Notice> = {
  "module-paused": (_facts, app) => ({ level: "now", title: "模块连续失败，已暂停", body: `应用 ${app} 连续三次失败，已停止自动恢复。请在应用页查看故障详情，或运行 chrona admin diagnostics ${app}。修复后再启用；此前失败调用不会自动重放。` }),
  "module-activated": (facts, app) => {
    return { level: "digest", title: `应用 ${app} 已自动${facts.update ? "更新" : "启用"}`, body: `版本 hash: ${String(facts.hash)}\n可在应用历史中查看变更或回滚` };
  },
  "module-build-failed": (_facts, app) => ({ level: "digest", title: `模块 ${app} 构建失败`, body: "连续构建失败，已停止自动重试。请检查测试报告后重新提交。" }),
  "module-migration-failed": (facts, app) => ({ level: "now", title: facts.restore ? `模块 ${app} 回滚未完成：数据恢复失败` : `模块 ${app} 新版本未启用：数据迁移失败`, body: "旧版本继续运行，请检查迁移报告后重新提交。" }),
  "schedule-failed": (facts, _app, error) => ({ level: "now", title: facts.disconnected ? "日程结果待核对" : "日程未完成", body: facts.disconnected
    ? `${String(facts.target)} 的日程在投递中断开，结果未知；不会自动重放，请核对实际结果。`
    : `${String(facts.target)} 的日程${facts.status === "unknown" ? "结果未知，请核对实际结果；不会自动重放" : "投递失败，已停止自动尝试"}。${error}` }),
  "build-paused": facts => ({ level: "now", title: "模块构建已暂停", body: `${facts.status === "timed_out" ? "本轮构建已达到时限" : "本轮构建未完成"}，已有文件和过程已保留。请查看构建会话，决定是否修改需求并继续；不会自动重试。\n\n${String(facts.status)}` }),
};
/** Presentation of the finite runtime notices Chrona emits. No lifecycle decision is made here. */
export function lifecycleNotice(kind: string, facts: Args): Notice {
  if (!Object.hasOwn(notices, kind)) throw new Error(`Unknown lifecycle notice ${kind}`);
  return notices[kind]!(facts, String(facts.app ?? ""), typeof facts.error === "string" ? facts.error : "");
}
