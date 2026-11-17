import type { SessionSource } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import type { Caller, Json } from "./module-call-types";
import type { SystemTool } from "./module-system-tool-types";
export type { SystemTool } from "./module-system-tool-types";
export type { Caller } from "./module-call-types";
/**
 * A system module is in-process Chrona code, reached by the same routed calls and authenticated caller.
 * `unrecorded`: synchronous tools that omit invocation arguments and Run tool-result bodies.
 * Keyless system calls also omit the invocation receipt; keyed calls retain it for reconciliation.
 * `call`: the current call identity (sync identities need not have a ledger row). v2-20: `description` and `sessions` (the conversation
 * source a system module does its work in) show it to the user as a read-only app.
 */
export type SystemModule = { name: string; description: string; sessions?: SessionSource; tools: SystemTool[]; unrecorded?: string[]; handle(context: { ports: StewardPorts; workspaceId: string; caller: Caller; run?: { moduleRunId?: string; eventKey?: string; executionRunId?: string }; deadline?: number; call?: { id: string; key?: string; mode?: "sync" | "async" } }, tool: string, args: Record<string, unknown>): Promise<Json> };
