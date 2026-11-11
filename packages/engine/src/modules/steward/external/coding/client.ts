import { chrona, ModelError, type CallOptions, type CallTarget } from "chrona";

// Coding owns this client. Shared generated application addressing must never turn
// the kernel Agent namespace into a dependency on an application named Agent.
const tools = new Set(["agent.register", "agent.providers", "agent.run", "agent.read", "agent.write", "agent.stop", "agent.native"]);
function target(name: string): CallTarget {
  if (!tools.has(name)) throw new ModelError("unsupported", `Unsupported Coding kernel target: ${name}`);
  return name as CallTarget;
}
export function applicationCall<T>(name: string, input: Record<string, unknown>, options: CallOptions = {}): Promise<T> {
  return chrona.call<T>(target(name), input, options);
}
export function applicationCallStatus(selector: { target: string; key: string }) {
  return chrona.callStatus({ target: target(selector.target), key: selector.key });
}
