import { explicitCommand } from "./explicit-command";
import type { AdvanceDispatchResolution, BuildAdvanceDispatchCommandInput } from "./types";

export function buildAdvanceDispatchCommand(
  input: BuildAdvanceDispatchCommandInput,
): AdvanceDispatchResolution {
  return explicitCommand({
    command: input.command,
    state: input.state,
    trigger: input.trigger,
    context: input.context,
    executionSession: input.executionSession,
  });
}
