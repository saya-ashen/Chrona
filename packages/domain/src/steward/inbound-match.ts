// Greedy wildcard match without regex: sender text is untrusted, so avoid backtracking blow-ups.
function globMatches(pattern: string, text: string): boolean {
  let p = 0, t = 0, star = -1, resume = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] !== "*" && pattern[p] === text[t]) { p++; t++; }
    else if (p < pattern.length && pattern[p] === "*") { star = p++; resume = t; }
    else if (star >= 0) { p = star + 1; t = ++resume; }
    else return false;
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}
export function inboundMatches(match: { from?: string; subject?: string }, item: { from: string; subject: string }): boolean {
  return (match.from === undefined || globMatches(match.from.toLowerCase(), item.from.toLowerCase()))
    && (match.subject === undefined || item.subject.toLowerCase().includes(match.subject.toLowerCase()));
}
