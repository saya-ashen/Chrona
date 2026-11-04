import { useState } from "react";

export function localTime(value: unknown) {
  const date = typeof value === "string" && value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}
export function Time({ value }: { value: unknown }) {
  const label = localTime(value);
  return <time className="muted" dateTime={label === "时间未知" ? undefined : String(value)}>{label}</time>;
}
export function CollapsedText({ content, limit = 160 }: { content: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const body = String(content), long = body.length > limit;
  return <div><p className="notification-body">{long && !expanded ? `${body.slice(0, limit)}…` : body}</p>{long ? <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "展开全文"}</button> : null}</div>;
}
