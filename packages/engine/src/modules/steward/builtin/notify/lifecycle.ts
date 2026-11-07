type Args = Record<string, unknown>;
function retirementBody(facts: Args) {
  if (!facts.reflection && facts.mind === "enabled" && facts.healthFixes === null) return "你之前关闭了主动反思；当前 mind 版本没有「自主修复」开关，心智唤醒的 Chrona 仍可能自己启动修复构建。如不希望这样，请关闭 mind 的「主动唤醒」，或让 Chrona 在 mind 里加入「自主修复」开关。";
  if (!facts.reflection && facts.mind === "enabled") return "你之前关闭了主动反思，所以心智的「自主修复」已设为关闭：发现应用故障时只提醒你，不会自己启动修复构建。需要时可在 mind 应用的设置里打开。";
  return facts.mind === "disabled"
    ? "主动反思已并入心智，但心智的主动唤醒当前关闭，Chrona 不会自主发现和修复应用故障。需要时在 mind 应用的设置里打开「主动唤醒」。"
    : "主动反思已移除；当前没有启用的心智应用，Chrona 不会自主发现和修复应用故障。";
}
/** Presentation of the finite runtime notices Chrona emits. No lifecycle decision is made here. */
export function lifecycleNotice(kind: string, facts: Args): { title: string; body: string; level: "now" | "digest" } {
  const app = String(facts.app ?? ""), error = typeof facts.error === "string" ? facts.error : "";
  switch (kind) {
    case "module-paused": return { level: "now", title: "模块连续失败，已暂停", body: `应用 ${app} 连续三次失败，已停止自动恢复。请在应用页查看故障详情，或运行 chrona admin diagnostics ${app}。修复后再启用；此前失败调用不会自动重放。` };
    case "module-activated": {
      const changes = Array.isArray(facts.changes) ? facts.changes.map(String) : [], preserves = Array.isArray(facts.preserves) ? facts.preserves.map(String) : [];
      return { level: "digest", title: `应用 ${app} 已自动${facts.update ? "更新" : "启用"}`, body: `${[`变更：${changes.join("；")}`, preserves.length ? `保持：${preserves.join("；")}` : ""].filter(Boolean).join("\n").slice(0, 3500)}\n版本 hash: ${String(facts.hash)}\n可在应用历史中回滚` };
    }
    case "module-build-failed": return { level: "digest", title: `模块 ${app} 构建失败`, body: "连续构建失败，已停止自动重试。请检查测试报告后重新提交。" };
    case "module-migration-failed": return { level: "now", title: facts.restore ? `模块 ${app} 回滚未完成：数据恢复失败` : `模块 ${app} 新版本未启用：数据迁移失败`, body: "旧版本继续运行，请检查迁移报告后重新提交。" };
    case "schedule-failed": return { level: "now", title: facts.disconnected ? "日程结果待核对" : "日程未完成", body: facts.disconnected
      ? `${String(facts.target)} 的日程在投递中断开，结果未知；不会自动重放，请核对实际结果。`
      : `${String(facts.target)} 的日程${facts.status === "unknown" ? "结果未知，请核对实际结果；不会自动重放" : "投递失败，已停止自动尝试"}。${error}` };
    case "run-paused": {
      const reason = facts.uncertain ? "有操作的结果尚未确认，请先核对实际结果，避免重复执行。" : facts.status === "provider_unavailable" ? "模型服务不可用，请检查配置后再继续。" : "连续三次处理失败，请检查服务状态后再继续。";
      return { level: "now", title: "处理已暂停", body: `${reason}本次不会自动重试。${error ? `\n最近一次原因：${error.slice(0, 300)}` : ""}` };
    }
    case "reflection-retired": return { level: "digest", title: "主动反思已并入心智", body: retirementBody(facts) };
    case "build-paused": return { level: "now", title: "模块构建已暂停", body: `${facts.status === "timed_out" ? "本轮构建已达到时限" : "本轮构建未完成"}，已有文件和过程已保留。请查看构建会话，决定是否修改需求并继续；不会自动重试。\n\n${String(facts.outcome)}` };
    case "background-result": return { level: "now", title: String(facts.title ?? "后台处理完成"), body: String(facts.body ?? "") };
    default: throw new Error(`Unknown lifecycle notice ${kind}`);
  }
}
