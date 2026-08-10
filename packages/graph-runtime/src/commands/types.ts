import type {
  GraphExecutionCallbacks,
  GraphExecutorRegistry,
} from "../types/callbacks";
import type {
  GraphExecutionControl,
  GraphExecutionOutcome,
} from "../types/dispatch-primitives";
import type { GraphExecutionEvent } from "../types/events";
export type { GraphRuntimeCommand } from "./command-core";
import type { GraphRuntimeCommand } from "./command-core";

export type GraphRuntimePolicies = {
  maxSteps?: number;
  maxConcurrency?: number;
  retry?: { maxAttempts?: number };
  validateGraph?: boolean;
};

export type GraphRuntimeOptions<TContext = unknown> = {
  taskId: string;
  runtimeName: string;
  callbacks?: Partial<GraphExecutionCallbacks<TContext>>;
  executors?: GraphExecutorRegistry<TContext>;
  control?: GraphExecutionControl;
  policies?: GraphRuntimePolicies;
  now?: () => number;
};

export type GraphDispatchOutcome = GraphExecutionOutcome & {
  events: GraphExecutionEvent[];
};

export type GraphRuntime<_TContext = unknown> = {
  dispatch(command: GraphRuntimeCommand): Promise<GraphDispatchOutcome>;
};
