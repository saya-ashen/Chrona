import { z } from "zod";
import { mkdir } from "node:fs/promises";
import type { StewardPorts } from "./ports";
import { registerLocalModule } from "./module-calls";
import { tool, json } from "./system/shared";
import { runtimeCall } from "./local-runtime";
import * as files from "./local-content-files";
import { StewardError } from "./errors";
import { readLocalContentRef } from "./local-content-reference";

const text = z.string().min(1).max(8192), MAX = 20 * 1024 * 1024;
const attachment = z.object({ name: z.string(), ref: z.string(), size: z.number().int().nonnegative() }).strict();
export function registerContentModule() {
  const declarations = [
    ["mount", z.object({}).strict(), z.object({ name: z.literal("chat"), dir: text, writable: z.literal(false) }).strict()],
    ["put", z.object({ name: text, base64: z.string().max(4 * Math.ceil(MAX / 3)) }).strict(), attachment],
    ["read", z.object({ ref: text }).strict(), z.object({ base64: z.string().max(4 * Math.ceil(MAX / 3)), mime: text }).strict().nullable()],
    ["reference", z.object({ ref: text, maxBytes: z.number().int().positive().max(MAX) }).strict(), z.object({ ref: text, name: text, mime: text, sha256: z.string().regex(/^[a-f0-9]{64}$/), base64: z.string().max(4 * Math.ceil(MAX / 3)) }).strict()],
    ["capture", z.object({ cwd: text, path: text }).strict(), attachment],
  ] as const;
  registerLocalModule({ name: "content-local", description: "Local immutable attachments", unrecorded: declarations.map(([name]) => name),
    tools: declarations.map(([name, input, output]) => tool(name, "Scoped content operation", {}, [], { input, output, visibility: ["kernel"] })),
    async handle({ ports, workspaceId }, name, args) {
      if (name === "mount") {
        const dir = files.chatFilesDir(ports);
        await mkdir(dir, { recursive: true });
        return { name: "chat", dir, writable: false };
      }
      if (name === "reference") {
        const { bytes, ...file } = await readLocalContentRef(ports, workspaceId, String(args.ref), Number(args.maxBytes));
        return { ...file, base64: Buffer.from(bytes).toString("base64") };
      }
      if (name === "put") {
        const bytes = Buffer.from(String(args.base64), "base64");
        if (bytes.length > MAX || bytes.toString("base64") !== args.base64) throw new StewardError("invalid", "Invalid content bytes");
        return json(await files.storeChatFile(ports, String(args.name), bytes));
      }
      if (name === "capture") return json(await files.runFile(ports, String(args.cwd), String(args.path)));
      const file = await files.readChatFile(ports, String(args.ref));
      if (!file) return null;
      if (file.bytes.length > MAX) throw new StewardError("invalid", "Content exceeds read limit");
      return { base64: Buffer.from(file.bytes).toString("base64"), mime: file.mime };
    },
  });
}
async function invoke<T>(ports: StewardPorts, workspaceId: string, target: string, args: Record<string, unknown>): Promise<T> {
  registerContentModule();
  return runtimeCall<T>(ports, workspaceId, `content-local.${target}`, args);
}
export async function chatContentMount(ports: StewardPorts, workspaceId: string) {
  return invoke<{ name: "chat"; dir: string; writable: false }>(ports, workspaceId, "mount", {});
}
export async function storeChatFile(ports: StewardPorts, name: string, bytes: Uint8Array, workspaceId: string) {
  if (bytes.byteLength > MAX) throw new StewardError("invalid", "Content exceeds upload limit");
  return attachment.parse(await invoke(ports, workspaceId, "put", { name, base64: Buffer.from(bytes).toString("base64") }));
}
export async function runFile(ports: StewardPorts, cwd: string, path: string, workspaceId: string) {
  return attachment.parse(await invoke(ports, workspaceId, "capture", { cwd, path }));
}
export async function readChatFile(ports: StewardPorts, ref: string, workspaceId: string) {
  const result = z.object({ base64: z.string(), mime: z.string() }).strict().nullable().parse(await invoke(ports, workspaceId, "read", { ref }));
  return result ? { bytes: Buffer.from(result.base64, "base64"), mime: result.mime } : null;
}
