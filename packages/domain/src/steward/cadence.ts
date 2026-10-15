/** Human-readable cadence for validated positive minute intervals. */
export function formatCadence(minutes: number): string {
  if (minutes === 10080) return "每周";
  if (minutes === 1440) return "每天";
  if (minutes % 1440 === 0) return `每 ${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `每 ${minutes / 60} 小时`;
  return `每 ${minutes} 分钟`;
}
