import { randomUUID } from "node:crypto";
import { constants, accessSync, closeSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { workPlacementSchema, workBaselineSchema } from "@chrona/contracts/steward";
import { localDirectoryIdentity } from "@chrona/integrations/executor";

const absolute = z.string().min(1).refine(isAbsolute);
const origin = z.string().refine(value => { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash; } catch { return false; } });
const pi = z.object({ command: absolute, agentDir: absolute, model: z.string().min(1).max(200), expectedVersion: z.string().min(1).max(100).optional(), resourcesFile: absolute.optional() }).strict();
const mapping = workPlacementSchema.omit({ executorId: true }).extend({ canonicalPath: absolute, baseline: workBaselineSchema.refine(value => value.kind === "commit", "Only verified commit mappings are supported") }).strict();
const requestSchema = z.object({ origin, label: z.string().trim().min(1).max(200), pi, mappings: z.array(mapping).min(1).max(100) }).strict();
const configSchema = requestSchema.extend({ version: z.literal(1), mappings: z.array(mapping.extend({ directoryIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(100) }).strict();
export type ExecutorCliConfig = z.infer<typeof configSchema>;
export function privateDirectory(path: string, create = false) {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error("Executor paths must be absolute and canonical");
  if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path || stat.mode & 0o077 || stat.uid !== process.getuid?.()) throw new Error("Executor directory must be owned, private and canonical");
  return path;
}
export function privateRead(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid?.() || stat.size > 65_536) throw new Error("Executor file must be owned, private and bounded");
    return readFileSync(fd, "utf8");
  } finally { closeSync(fd); }
}
export function privateJson<T>(path: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try { raw = JSON.parse(privateRead(path)); } catch { throw new Error("Cannot read private executor JSON file"); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid executor configuration or identity");
  return parsed.data;
}
export function privateWrite(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.next`, fd = openSync(temporary, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(temporary, path); } catch (error) { unlinkSync(temporary); throw error; }
  const directory = openSync(dirname(path), "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
}
const contains = (parent: string, child: string) => { const value = relative(parent, child); return !value || value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value); };
export function validateExecutorPaths(config: ExecutorCliConfig, dataDir: string) {
  privateDirectory(config.pi.agentDir);
  if (realpathSync(config.pi.command) !== config.pi.command) throw new Error("Pi command must be canonical");
  accessSync(config.pi.command, constants.X_OK);
  for (const directory of [dataDir, ...config.mappings.map(item => item.canonicalPath)]) {
    if (contains(directory, config.pi.agentDir) || contains(config.pi.agentDir, directory)) throw new Error("Executor profile must be separate from data and workspaces");
  }
  if (config.mappings.some(item => contains(item.canonicalPath, dataDir) || contains(dataDir, item.canonicalPath))) throw new Error("Executor data must be separate from workspaces");
}
export function configureExecutor(dataDir: string, requestFile: string) {
  if (process.platform !== "linux") throw new Error("Executor supports verified Linux systemd 262 only");
  privateDirectory(dataDir, true);
  const input = privateJson(requestFile, requestSchema);
  const config: ExecutorCliConfig = { ...input, version: 1, mappings: input.mappings.map(item => ({ ...item, directoryIdentity: localDirectoryIdentity(item.canonicalPath) })) };
  if (new Set(config.mappings.map(item => JSON.stringify([item.projectRef, item.mappingRevision]))).size !== config.mappings.length) throw new Error("Duplicate executor mapping");
  validateExecutorPaths(config, dataDir);
  const target = join(dataDir, "config.json");
  if (lstatSync(join(dataDir, "identity.json"), { throwIfNoEntry: false })) throw new Error("Paired executor configuration is immutable; select a new private directory");
  privateWrite(target, config);
}
export function readExecutorConfig(dataDir: string) { privateDirectory(dataDir); return privateJson(join(dataDir, "config.json"), configSchema); }
