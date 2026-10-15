import { AgentUnavailableError, type Assessor } from "@chrona/contracts/steward";
/** Deterministic health changes only. Source text never grants authority. */
export function createRuleAssessor({ available }: { available: () => boolean }): Assessor {
  return {
    name: "rule-assessor-v2",
    async assess({ event, affairs }) {
      if (!available()) throw new AgentUnavailableError();
      const text = `${event.title}\n${event.body}`.toLowerCase();
      const matches = affairs.filter(a => a.title.toLowerCase().split(/[\s,，、:：]+/).some(word => word.length > 1 && text.includes(word)));
      // Engine orders linked affairs first, but the port deliberately carries no connection identifiers.
      const affairId = matches.length === 1 ? matches[0]!.id : null;
      const recovered = /已恢复|恢复正常|\b(back up|recovered|restored)\b/i.test(event.title);
      const down = /不可用|状态异常|\b(down|offline|unhealthy)\b/i.test(event.title);
      return { disposition: recovered ? "record" : down ? "notify" : "ignore", affairId, whatHappened: (event.title.trim() || "Source changed").slice(0, 4000), whyItMatters: recovered ? "服务已恢复，可查看事项确认状态。" : down ? "服务可用性发生变化，请查看事项详情。" : "没有识别到服务可用性变化。", important: down && !recovered };
    },
  };
}
