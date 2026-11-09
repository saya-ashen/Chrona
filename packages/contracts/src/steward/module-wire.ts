import { z } from "zod";
import { moduleCallReplySchema, moduleCallSchema, moduleEventMessageSchema, moduleEventReplySchema } from "./index";

/** Language-neutral local module protocol v1. See schemas/module-wire.json and docs/module-wire.md. */
export const moduleAuthSchema = z.object({ type: z.literal("auth"), version: z.literal(1), token: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export const moduleReadySchema = z.object({ type: z.literal("ready"), version: z.literal(1) }).strict();
export const moduleHttpReadySchema = z.object({ type: z.literal("http-ready"), endpoint: z.string().regex(/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/) }).strict();
export const modulePingSchema = z.object({ id: z.string().min(1).max(64), ping: z.literal(true) }).strict();
export const moduleWireMessageSchema = z.union([
  moduleAuthSchema, moduleReadySchema, moduleHttpReadySchema, modulePingSchema,
  moduleEventMessageSchema, moduleEventReplySchema, moduleCallSchema, moduleCallReplySchema,
]);

export const moduleWireTransport = {
  version: 1,
  ipcEndpoint: "tcp://127.0.0.1:<port>",
  ipcEndpointEnv: "CHRONA_IPC_ENDPOINT",
  tokenEnv: "CHRONA_IPC_TOKEN",
  tokenBytes: 32,
  framing: "UTF-8 JSON followed by LF; limits count bytes excluding LF",
  maxLineBytes: 32 * 1024 * 1024,
  maxHandshakeBytes: 1024,
  handshakeDeadlineMs: 5000,
  maxPendingConnections: 16,
  httpEndpoint: "http://127.0.0.1:<port>",
  httpTokenHeader: "x-chrona-module-token",
  httpToken: "Same per-instance token as IPC; injected by kernel/preview proxy only",
} as const;
