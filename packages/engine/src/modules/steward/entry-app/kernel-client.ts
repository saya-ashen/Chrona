import { chrona, ModelError, type CallTarget, type CallOptions } from "chrona";

type Args = Record<string, unknown>;
const kernel = /^(agent|modules|approvals|settings|secrets|activity|timers|runtime-callback|workspace-local)\./;
function address(target: string | { moduleId: string; tool: string }, expected?: CallOptions["expectedTarget"]): CallTarget {
  if (typeof target !== "string") return target;
  if (kernel.test(target)) return target as CallTarget;
  const boundary = target.indexOf("."), name = target.slice(0, boundary);
  const moduleId = expected?.moduleId ?? chrona.dependencies[name];
  if (!moduleId) throw new ModelError("not_found", `Application ${name} is not installed`);
  return { moduleId, tool: target.slice(boundary + 1) };
}
/** One call preserves the kernel's page, target identity and explicit call options. */
export async function applicationCall<T = unknown>(target: string | { moduleId: string; tool: string }, args: Args = {}, 
  options: CallOptions = {}): Promise<T> {
  if (typeof target === "string" && kernel.test(target)) {
    if (["request-key", "requestKey", "command-key", "commandKey"].some(key => Object.hasOwn(args, key))) {
      throw new ModelError("invalid", "Kernel command keys belong in CallOptions.key");
    }
    if (target === "modules.describe" && typeof args.target === "string") args = { ...args, target: address(args.target) };
  }
  return chrona.call<T>(address(target, options.expectedTarget), args, options);
}
