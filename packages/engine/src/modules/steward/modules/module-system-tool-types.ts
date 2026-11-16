import type { z } from "zod";
import type { Tool, Json } from "./module-call-types";

/** Static system tool declarations do not depend on handlers or execution ports. */
export type SystemTool = Omit<Tool, "output" | "examples"> & { contractTarget?: string; input?: z.ZodType; output?: z.ZodType; documentation?: string; examples?: Json[]; sideEffects?: string[]; errors?: { code: string; description: string; recovery: string }[] };
