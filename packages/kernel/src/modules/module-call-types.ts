import type { z } from "zod";
import type { callerSchema, ModuleManifest } from "@chrona/contracts/steward";

export type Caller = z.infer<typeof callerSchema>;
/** A JSON value as the contract carries it. */
export type Json = z.output<ReturnType<typeof z.json>>;
/**
 * Who is calling, as Chrona knows it. `chain` holds the modules waiting on this call path (sync), `path` every module on it.
 * `run`: the module event being handled, for system modules that budget per event (provider.complete).
 * `deadline` is ms since epoch: when the caller stops waiting; system tools that wait finish by then.
 */
export type CallOrigin = { workspaceId: string; caller: Caller; chain: string[]; path: string[]; run?: { moduleRunId?: string;
  eventKey?: string; executionRunId?: string }; deadline?: number };
export type Tool = ModuleManifest["tools"][number];
export type RoutedTool = Pick<Tool, "name" | "description" | "parameters" | "visibility" | "idempotent"> & { readOnly?: true;
  output?: unknown; examples?: unknown; sideEffects?: unknown; errors?: unknown };
