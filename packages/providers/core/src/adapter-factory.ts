import {
  createRuntimeAdapter as createOpenClawAdapter,
  OPENCLAW_RUNTIME_ADAPTER_KEY,
  type OpenClawAdapterConfig,
} from "@chrona/openclaw";
import type { OpenClawAdapter } from "@chrona/openclaw";

export { OPENCLAW_RUNTIME_ADAPTER_KEY as DEFAULT_RUNTIME_ADAPTER_KEY } from "@chrona/openclaw";
export {
  getOpenClawTaskConfigSpec,
  OPENCLAW_RUNTIME_INPUT_VERSION,
  validateOpenClawTaskConfig,
} from "@chrona/openclaw";

export type RuntimeAdapter = OpenClawAdapter;
export type RuntimeAdapterConfig = OpenClawAdapterConfig;

export type {
  OpenClawApprovalDecision,
  OpenClawChatHistory,
  OpenClawPendingApproval,
  OpenClawRunSnapshot,
} from "@chrona/openclaw";

export type RuntimeAdapterFactory<A = RuntimeAdapter> = (config?: RuntimeAdapterConfig) => Promise<A>;

const runtimeAdapterFactories = new Map<string, (...args: unknown[]) => Promise<unknown>>([
  [OPENCLAW_RUNTIME_ADAPTER_KEY, (config) => createOpenClawAdapter(config as RuntimeAdapterConfig | undefined)],
]);

export function registerRuntimeAdapterFactory<A = RuntimeAdapter>(
  key: string,
  factory: RuntimeAdapterFactory<A>,
): void {
  runtimeAdapterFactories.set(key, factory as (...args: unknown[]) => Promise<unknown>);
}

export async function createRuntimeAdapter<A = RuntimeAdapter>(
  key?: string,
  config?: RuntimeAdapterConfig,
): Promise<A> {
  const actualKey = key ?? OPENCLAW_RUNTIME_ADAPTER_KEY;
  const factory = runtimeAdapterFactories.get(actualKey);
  if (!factory) {
    throw new Error(`No runtime adapter factory registered for key: ${actualKey}`);
  }
  return factory(config) as Promise<A>;
}
