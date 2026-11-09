import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { z } from "zod";
import { localDirectoryIdentity, privateRoot } from "@chrona/workspaces";
import { realpathSync, statSync } from "node:fs";
import { deviceSchema } from "./protocol";
import { readPrivate, writePrivate } from "./private-files";

export const mappingSchema = z.object({ workspaceRef: z.string().min(1).max(200), targetRef: z.string().min(1), targetRevision: z.number().int().positive(), projectRef: z.string().min(1), canonicalPath: z.string().min(1), directoryIdentity: z.string().min(1), baseline: z.object({ kind: z.enum(["commit", "snapshot"]), digest: z.string().min(1) }).strict(), workspaceModes: z.array(z.enum(["existing", "independent_worktree"])).min(1).max(2) }).strict();
export const piConfigSchema = z.object({ command: z.string().min(1), expectedVersion: z.literal("1.5.0") }).strict();
export function localPi(input: unknown): z.infer<typeof piConfigSchema> {
  const config = piConfigSchema.parse(input);
  if (resolve(config.command) !== config.command) throw new Error("Pi executable must be absolute");
  const command = realpathSync(config.command), stat = statSync(command);
  if (!stat.isFile() || !(stat.mode & 0o111) || (stat.mode & 0o022)) throw new Error("Pi executable must be executable and protected against shared writes");
  return { ...config, command };
}
export const configSchema = z.object({ version: z.literal(1), server: z.string().url(), credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/), privateKey: z.string(), publicKey: z.string(), deviceId: z.string().min(1).max(128), incarnation: z.string().min(1).max(128), keyId: z.string().min(1).max(128), device: deviceSchema.nullable(), pairing: z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/), requestId: z.string() }).strict().nullable(), mappings: z.array(mappingSchema).max(100), pi: piConfigSchema.nullable().default(null) }).strict();
export type DeviceConfig = z.infer<typeof configSchema>;
export type Mapping = z.infer<typeof mappingSchema>;
export function serverURL(input: string): string {
  const url = new URL(input);
  if (url.username || url.password || url.hash || url.search || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))) throw new Error("Server must be an HTTPS origin or HTTP loopback origin");
  return url.origin;
}
export function loadConfig(root: string): DeviceConfig {
  privateRoot(root);
  const value = configSchema.parse(JSON.parse(readPrivate(join(root, "config.json"))));
  serverURL(value.server);
  if (createPrivateKey(value.privateKey).asymmetricKeyType !== "ed25519" || createPublicKey(value.privateKey).export({ type: "spki", format: "pem" }).toString() !== value.publicKey) throw new Error("Device key mismatch");
  if (value.device && (value.device.deviceId !== value.deviceId || value.device.incarnation !== value.incarnation || value.device.keyId !== value.keyId)) throw new Error("Paired identity mismatch");
  return value;
}
export function saveConfig(root: string, config: DeviceConfig) { writePrivate(join(root, "config.json"), configSchema.parse(config)); }
export function initializeConfig(root: string, server: string, deviceId: string): DeviceConfig {
  if (process.platform !== "linux") throw new Error("Only Linux device execution has been verified");
  if (resolve(root) !== root) throw new Error("Device directory must be absolute and canonical");
  privateRoot(root);
  const keys = generateKeyPairSync("ed25519");
  const config = configSchema.parse({ version: 1, server: serverURL(server), credential: randomBytes(32).toString("base64url"), privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), deviceId, incarnation: randomUUID(), keyId: randomUUID(), device: null, pairing: null, mappings: [] });
  writePrivate(join(root, "config.json"), config, false);
  return config;
}
export function localMapping(input: Omit<Mapping, "directoryIdentity" | "canonicalPath"> & { path: string }): Mapping {
  const canonicalPath = realpathSync(input.path);
  const { path: _, ...rest } = input;
  return mappingSchema.parse({ ...rest, canonicalPath, directoryIdentity: localDirectoryIdentity(canonicalPath) });
}
