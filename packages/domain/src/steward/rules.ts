import { rulesFileSchema, type RuleAction } from "@chrona/contracts/steward";

/** File contents may be parsed JSON or the raw JSON string. External text only
 * selects an inbound disposition; it never confers permissions. */
export function applyRules(rulesFile: unknown, item: { from: string; subject: string; body: string }): { action: RuleAction; note: string } {
  if (rulesFile === null) return { action: "batch", note: "" };
  let input = rulesFile;
  if (typeof input === "string") {
    try { input = JSON.parse(input); } catch { return { action: "batch", note: "rules.json 无效" }; }
  }
  const parsed = rulesFileSchema.safeParse(input);
  if (!parsed.success) return { action: "batch", note: "rules.json 无效" };
  for (const rule of parsed.data.rules) {
    if ((["from", "subject", "body"] as const).every(key => rule.match[key] === undefined || item[key].toLowerCase().includes(rule.match[key].toLowerCase()))) return { action: rule.action, note: rule.note };
  }
  return { action: parsed.data.default, note: "" };
}
