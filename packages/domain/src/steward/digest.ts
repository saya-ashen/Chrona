export function composeDigest(items: readonly { affairTitle: string | null; title: string; body: string }[], { dayLabel }: { dayLabel: string }): { title: string; body: string } | null {
  if (!items.length) return null;
  const groups = new Map<string | null, typeof items[number][]>();
  for (const item of items.slice(0, 10)) {
    const group = groups.get(item.affairTitle) ?? [];
    group.push(item);
    groups.set(item.affairTitle, group);
  }
  const sections = [...groups].map(([title, group]) => `${title ?? "其他动态"}\n${group.map((item) => `- ${item.title}：${item.body}`).join("\n")}`);
  if (items.length > 10) sections.push(`另有 ${items.length - 10} 条`);
  return { title: `${dayLabel}日报`, body: sections.join("\n\n") };
}
