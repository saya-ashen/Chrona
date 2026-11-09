/** Notification presentation only; approval identity and decisions remain kernel-owned. */
export function approvalNoticeBody(row: { action: string; detail: string | null; preview: string | null }) {
  const full = () => [row.detail, row.preview].filter(Boolean).join("\n\n").slice(0, 1500);
  if (row.action !== "activate_module" || !row.preview) return full();
  const sections = row.preview.startsWith("【") ? row.preview.split(/\n\n(?=【[^】\n]+】\n)/) : [row.preview];
  const summaries = sections.map(section => moduleSummary(section.split("\n")));
  if (summaries.some(summary => summary === null)) return full();
  return [row.detail, ...summaries, "完整差异、测试结果和 hash 请在网页「待你决定」中查看。"].filter(Boolean).join("\n\n").slice(0, 1500);
}
function moduleSummary(lines: string[]) {
  const diffAt = lines.findIndex(line => line.startsWith("--- active"));
  if (diffAt < 0) return null;
  let changes: string[] = [];
  try {
    const intent = JSON.parse(lines.find(line => line.startsWith("意图："))?.slice(3) ?? "");
    if (Array.isArray(intent.changes) && intent.changes.every((change: unknown) => typeof change === "string")) changes = intent.changes;
  } catch { /* No readable intent: the page has it. */ }
  return [lines.slice(0, diffAt).join("\n"), changes.length ? `改动：\n${changes.map(change => `• ${change}`).join("\n")}` : null].filter(Boolean).join("\n");
}
