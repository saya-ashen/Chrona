import type { z } from "zod";
import type { ModuleManifest, ModuleSetting, SessionSource, callerSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "./ports";
type Tool = ModuleManifest["tools"][number];
type Json = z.output<ReturnType<typeof z.json>>;
export type Caller = z.infer<typeof callerSchema>;
export type SystemTool = Omit<Tool, "output" | "examples"> & { input?: z.ZodType; output?: z.ZodType; documentation?: string; examples?: Json[]; sideEffects?: string[]; errors?: { code: string; description: string; recovery: string }[] };
/**
 * `call`: the async call being delivered (absent for sync calls). v2-20: `description` and `sessions` (the conversation
 * source a system module does its work in) show it to the user as a read-only app.
 */
/** v2-23: settings a system module shows on its app page; values live in the owner's Settings (read/write map them). */
export type SystemSettings = { declarations: Record<string, ModuleSetting>; read(settings: unknown): Record<string, string | number | boolean>; write(values: Record<string, unknown>): Record<string, unknown> };
export type SystemModule = { name: string; description: string; sessions?: SessionSource; settings?: SystemSettings; tools: SystemTool[]; unrecorded?: string[]; handle(context: { ports: StewardPorts; workspaceId: string; caller: Caller; run?: { moduleRunId?: string; eventKey?: string; executionRunId?: string }; deadline?: number; call?: { id: string } }, tool: string, args: Record<string, unknown>): Promise<Json> };
