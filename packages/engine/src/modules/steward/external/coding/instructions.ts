import { codingError } from "./storage";

/** Coding's work protocol travels as task data through the governed execution API. */
export function codingGoal(goal: string): string {
  const prompt = `${goal}\n\nCoding work: edit the selected project directory directly and follow its project rules. Report changes, checks actually run, unresolved questions and artifact references. Commit, push, merge, deploy and workspace cleanup require explicit authorization.`;
  if (prompt.length > 20_000) throw codingError("too_large", "Coding instructions and goal exceed execution request budget");
  return prompt;
}
