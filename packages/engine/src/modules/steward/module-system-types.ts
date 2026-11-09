import type { z } from "zod";
import type { SessionSource } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
import type { Caller, Tool, Json } from "./module-call-types";
export type { Caller } from "./module-call-types";
/** A system tool may validate with a full schema (`input`) instead of scalar parameters. */
export type SystemTool = Omit<Tool, "output" | "examples"> & { input?: z.ZodType; output?: z.ZodType; documentation?: string; examples?: Json[]; sideEffects?: string[]; errors?: { code: string; description: string; recovery: string }[] };
/**
 * A system module is in-process Chrona code, reached by the same routed calls and recorded caller.
 * `unrecorded`: tools called only synchronously whose arguments and results are never stored.
 * `call`: the async call being delivered (absent for sync calls). v2-20: `description` and `sessions` (the conversation
 * source a system module does its work in) show it to the user as a read-only app.
 */
export type SystemModule = { name: string; description: string; sessions?: SessionSource; tools: SystemTool[]; unrecorded?: string[]; handle(context: { ports: StewardPorts; workspaceId: string; caller: Caller; run?: { moduleRunId?: string; eventKey?: string; executionRunId?: string }; deadline?: number; call?: { id: string } }, tool: string, args: Record<string, unknown>): Promise<Json> };
