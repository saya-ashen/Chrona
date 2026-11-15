// Display only: keep the original goal and feedback metadata in the record.
export function taskTitle(goal: string): string {
  return goal.split(/\r?\n/, 1)[0]!
    .replace(/\s*反馈(?:对应版本|页面)[：:].*$/u, '')
    .replace(/\b(?:[a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\b/gi, '')
    .replace(/\s*[·|｜—-]\s*$/u, '')
    .trim() || '应用改进';
}
