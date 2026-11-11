import { agentProviderRegisterInput } from "@chrona/contracts/steward";
import { configureInput, type createConfiguration } from "./configuration";
import { PiError } from "./operations";

export const REGISTRATION = agentProviderRegisterInput.parse({
  id: "pi", name: "Pi", protocolVersion: 1,
  capabilities: { conversation: true, completion: true, native: true, images: true, interactions: true, resume: true },
  endpoints: { health: "health", start: "start", status: "status", inject: "inject", abort: "abort", release: "release", transcript: "transcript", native: "native", complete: "complete" },
  configuration: { tool: "configure", page: "settings" },
});
/** Archive before advertising a revision; serialize writes and registration so newer settings cannot be overwritten by an older response. */
export function createRegistration(configuration: ReturnType<typeof createConfiguration>, call: (target: string, args: Record<string, unknown>) => Promise<unknown>) {
  let pending = Promise.resolve(), dirty = false;
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const task = pending.then(work);
    pending = task.then(() => {}, () => {});
    return task;
  }
  async function register() {
    const saved = await configuration.archive();
    const result = await call("agent.register", { ...REGISTRATION, configuration: { ...REGISTRATION.configuration!, revision: saved.revision } });
    if (result && typeof result === "object" && "error" in result) throw new PiError("unavailable", "Pi provider registration rejected");
    dirty = false;
    return saved;
  }
  async function configure(raw: unknown) {
    const args = configureInput.parse(raw);
    return serialize(async () => {
      const result = await configuration.configure(args);
      if (args.config !== undefined || args.clear || args.form) { dirty = true; return register(); }
      return result;
    });
  }
  async function activate() { dirty = true; await serialize(register); }
  async function refresh() {
    if (!dirty) return;
    try { await serialize(register); }
    catch { console.error("Pi 提供方配置登记失败，稍后重试"); }
  }
  return { activate, configure, refresh };
}
