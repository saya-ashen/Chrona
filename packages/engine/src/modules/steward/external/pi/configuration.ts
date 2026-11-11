import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { z } from "zod";
import { THINKING_LEVELS } from "@chrona/contracts/steward";
import type { PiProviderOptions } from "@chrona/pi";
import { transcriptRedactor } from "@chrona/logging/redaction";
import { writeJournal } from "./journal";

export { THINKING_LEVELS };
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
// Reject text/URLs/credential assignments rather than returning arbitrary profile strings.
const safeId = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,249}$/.test(value)
  && !value.includes("://") && transcriptRedactor()(value, 500) === value;
export const modelSchema = z.string().trim().min(1).max(500).refine(value => value.split("/").every(safeId), "Invalid model ID");
export const configurationSchema = z.object({
  profile: z.string().min(1).max(4096).refine(value => isAbsolute(value) && normalize(value) === value && !Array.from(value).some(character => character.charCodeAt(0) < 32), "Use a canonical absolute directory").optional(),
  model: modelSchema.optional(), thinking: z.enum(THINKING_LEVELS).optional(),
}).strict();
export const configurationFormSchema = z.object({ profile: z.string().trim().max(4096), model: z.string().trim().max(500), thinking: z.enum(["", ...THINKING_LEVELS]) }).strict();
export const configureInput = z.object({ config: configurationSchema.optional(), clear: z.boolean().optional(), view: z.boolean().optional(), form: configurationFormSchema.optional() }).strict()
  .refine(value => [value.config !== undefined, value.clear === true, value.form !== undefined].filter(Boolean).length <= 1, "Choose config, form or clear");
const sourceSchema = z.enum(["configuration", "host", "profile", "pi-default"]);
const profileSourceSchema = z.enum(["configuration", "host.agentDir", "env.PI_CODING_AGENT_DIR", "default.HOME/.pi/agent"]);
export const effectiveSchema = z.object({
  profile: z.string(), profileSource: profileSourceSchema, profileStatus: z.enum(["available", "unavailable"]),
  model: z.string().nullable(), modelSource: sourceSchema, thinking: z.enum(THINKING_LEVELS).nullable(), thinkingSource: sourceSchema,
  warnings: z.array(z.string()),
}).strict();
export const configureOutput = z.object({ config: configurationSchema, revision: z.string(), effective: effectiveSchema, form: configurationFormSchema }).strict();
export const modelsInput = z.object({}).strict();
export const modelsOutput = z.object({
  profile: z.string(), profileSource: profileSourceSchema,
  items: z.array(z.object({ id: modelSchema, label: z.string(), source: z.enum(["models.json", "settings.json"]) }).strict()),
  options: z.array(z.object({ value: z.string(), label: z.string() }).strict()),
  warnings: z.array(z.string()), limited: z.boolean(),
}).strict();
export type Configuration = z.infer<typeof configurationSchema>;
export type ConfigurationView = z.infer<typeof configureOutput>;
export type ConfigurationSnapshot = ConfigurationView & { options: PiProviderOptions & { thinking?: ThinkingLevel } };
export const launchConfigurationSchema = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/), configurationRevision: z.string().regex(/^[a-f0-9]{64}$/), effective: effectiveSchema.omit({ warnings: true }).extend({
  modelSource: z.enum(["configuration", "host", "profile", "pi-default", "run", "kernel"]),
  thinkingSource: z.enum(["configuration", "host", "profile", "pi-default", "run"]),
}) }).strict();
export type LaunchConfiguration = z.infer<typeof launchConfigurationSchema>;
/** Non-secret configuration identity retained beside the process claim. */
export function launchConfiguration(snapshot: ConfigurationSnapshot, overrides: { model?: string; thinking?: ThinkingLevel }, pinnedModel?: string): LaunchConfiguration {
  const { warnings: _warnings, ...effective } = snapshot.effective;
  const selected = { ...effective, ...(overrides.model ? { model: overrides.model, modelSource: "run" as const } : {}),
    ...(overrides.thinking ? { thinking: overrides.thinking, thinkingSource: "run" as const } : {}), ...(pinnedModel ? { model: pinnedModel, modelSource: "kernel" as const } : {}) };
  return { revision: hash({ configurationRevision: snapshot.revision, effective: selected }), configurationRevision: snapshot.revision, effective: selected };
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const canonical = (config: Configuration): Configuration => ({ ...(config.profile ? { profile: config.profile } : {}), ...(config.model ? { model: config.model } : {}), ...(config.thinking ? { thinking: config.thinking } : {}) });
const invalid = (message: string) => Object.assign(new Error(message), { code: "invalid" });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

async function canonicalDirectory(path: string) {
  try { return isAbsolute(path) && normalize(path) === path && await realpath(path) === path && (await stat(path)).isDirectory(); }
  catch { return false; }
}
/** Never follow profile-file symlinks or expose parser errors/file contents. */
async function profileJson(profile: string, name: "settings.json" | "models.json", warnings: string[]) {
  try {
    const file = await open(join(profile, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Invalid profile file");
      const buffer = Buffer.alloc(1024 * 1024 + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 1024 * 1024) throw new Error("Invalid profile file");
      const value: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
      if (!record(value)) throw new Error("Invalid profile JSON");
      return value;
    } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") warnings.push(`${name} 无法安全读取；请检查文件格式、大小和权限。`);
    return {};
  }
}
function selectedProfile(config: Configuration, host: PiProviderOptions) {
  if (config.profile) return { profile: config.profile, profileSource: "configuration" as const };
  if (host.agentDir) return { profile: host.agentDir, profileSource: "host.agentDir" as const };
  if (process.env.PI_CODING_AGENT_DIR) return { profile: process.env.PI_CODING_AGENT_DIR, profileSource: "env.PI_CODING_AGENT_DIR" as const };
  return { profile: join(process.env.HOME || homedir(), ".pi", "agent"), profileSource: "default.HOME/.pi/agent" as const };
}
function effectiveValue<T>(configured: T | undefined, hosted: T | undefined, profiled: T | null) {
  if (configured !== undefined) return { value: configured, source: "configuration" as const };
  if (hosted !== undefined) return { value: hosted, source: "host" as const };
  return { value: profiled, source: profiled === null ? "pi-default" as const : "profile" as const };
}
function profileModel(settings: Record<string, unknown>) {
  const provider = settings.defaultProvider, model = settings.defaultModel;
  return typeof provider === "string" && safeId(provider) && typeof model === "string" && modelSchema.safeParse(model).success
    ? modelSchema.safeParse(`${provider}/${model}`).data ?? null : null;
}
async function effectiveConfiguration(config: Configuration, host: PiProviderOptions & { thinking?: ThinkingLevel }) {
  const selected = selectedProfile(config, host), warnings: string[] = [];
  if (!config.profile) selected.profile = await realpath(resolve(selected.profile)).catch(() => resolve(selected.profile));
  const available = await canonicalDirectory(selected.profile);
  if (!available) warnings.push("配置目录不可用；请明确选择当前服务用户可访问的规范绝对目录。");
  const settings = available ? await profileJson(selected.profile, "settings.json", warnings) : {};
  const model = effectiveValue(config.model, modelSchema.safeParse(host.model).data, profileModel(settings));
  const thinking = effectiveValue(config.thinking, z.enum(THINKING_LEVELS).safeParse(host.thinking).data, z.enum(THINKING_LEVELS).safeParse(settings.defaultThinkingLevel).data ?? null);
  return effectiveSchema.parse({ ...selected, profileStatus: available ? "available" : "unavailable", model: model.value, thinking: thinking.value, warnings,
    modelSource: model.source, thinkingSource: thinking.source });
}
/** Copy only adapter fields: unknown host properties (including credentials) never enter a snapshot. */
function adapterOptions(host: PiProviderOptions): PiProviderOptions & { thinking?: ThinkingLevel } {
  return { command: host.command, expectedVersion: host.expectedVersion, resourcesFile: host.resourcesFile, executionMode: host.executionMode,
    chronaExtension: host.chronaExtension, webExtension: host.webExtension, agentUrl: host.agentUrl,
    browserExtension: host.browserExtension, browsers: host.browsers, workspaceRoot: host.workspaceRoot,
    idleTimeoutMs: host.idleTimeoutMs, nativeTimeoutMs: host.nativeTimeoutMs, launch: host.launch, processHelper: host.processHelper };
}
async function discoverModels(effective: z.infer<typeof effectiveSchema>) {
  const warnings = [...effective.warnings], items: z.infer<typeof modelsOutput>["items"] = [], seen = new Set<string>();
  let limited = false;
  const add = (candidate: unknown, source: "models.json" | "settings.json") => {
    const parsed = modelSchema.safeParse(candidate);
    if (!parsed.success || seen.has(parsed.data)) return;
    if (items.length >= 500) { limited = true; return; }
    seen.add(parsed.data); items.push({ id: parsed.data, label: parsed.data, source });
  };
  if (effective.profileStatus === "available") {
    const models = await profileJson(effective.profile, "models.json", warnings);
    // Only the documented provider/model ID fields are examined. No auth.json, endpoints, headers, names or keys.
    const entries = record(models.providers) ? Object.entries(models.providers) : [];
    for (const [provider, value] of entries) {
      if (!safeId(provider) || !record(value) || !Array.isArray(value.models)) continue;
      for (const model of value.models) {
        if (record(model) && typeof model.id === "string") add(`${provider}/${model.id}`, "models.json");
      }
    }
    const settings = await profileJson(effective.profile, "settings.json", warnings);
    const model = profileModel(settings);
    if (model) add(model, "settings.json");
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return { profile: effective.profile, profileSource: effective.profileSource, items,
    options: [{ value: "", label: "继承所选 Pi 配置" }, ...items.map(item => ({ value: item.id, label: item.label }))],
    warnings: [...new Set(warnings)], limited };
}

/**
 * Runtime must enforce owner authorization before configure/models. No privileged callback is used here.
 * config/form REPLACE all overrides; empty form fields and clear:true restore inheritance.
 * configure returns only the safe public view. snapshot adds private adapter options, for runtime use only.
 * revision hashes canonical overrides plus effective profile/model/thinking (including source labels).
 * Profile resources remain owned by Pi; this service never changes profile files or starts a process.
 */
export function createConfiguration(data: string, hostOptions: PiProviderOptions & { thinking?: ThinkingLevel }) {
  const path = join(data, "configuration.json"), host = { ...hostOptions };
  let writes = Promise.resolve();
  async function read(): Promise<Configuration> {
    await writes;
    try {
      const stored = z.object({ config: configurationSchema, revision: z.string() }).strict().parse(JSON.parse(await readFile(path, "utf8")));
      const config = canonical(stored.config);
      if (stored.revision !== hash(config)) throw new Error("Invalid revision");
      return config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw invalid("Pi 配置记录无效；请修复私有配置后重试。");
    }
  }
  async function view(): Promise<ConfigurationView> {
    const config = await read(), effective = await effectiveConfiguration(config, host);
    const { warnings: _warnings, ...identity } = effective;
    return { config, effective, revision: hash({ config, effective: identity }),
      form: { profile: config.profile ?? "", model: config.model ?? "", thinking: config.thinking ?? "" } };
  }
  async function configure(raw: unknown): Promise<ConfigurationView> {
    // Parse errors use fixed messages so a rejected credential-bearing value cannot be echoed.
    const parsed = configureInput.safeParse(raw);
    if (!parsed.success) throw invalid("Pi 设置无效：请检查目录、模型和思考强度。");
    const args = parsed.data;
    if (args.config !== undefined || args.clear || args.form) {
      const input = args.form ? Object.fromEntries(Object.entries(args.form).filter(([, value]) => value !== "")) : args.clear ? {} : args.config;
      const result = configurationSchema.safeParse(input);
      if (!result.success) throw invalid("Pi 设置无效：请检查目录、模型和思考强度。");
      const config = canonical(result.data);
      const write = writes.then(async () => {
        if (config.profile && !await canonicalDirectory(config.profile)) throw invalid("配置目录必须是已存在的规范绝对目录，不能使用符号链接。");
        await mkdir(data, { recursive: true, mode: 0o700 });
        await writeJournal(path, { config, revision: hash(config) });
      });
      writes = write.catch(() => {});
      await write;
    }
    return view();
  }
  async function archived(revision: string): Promise<ConfigurationView> {
    if (!/^[a-f0-9]{64}$/.test(revision)) throw invalid("Pi 配置版本无效。");
    try {
      const saved = configureOutput.parse(JSON.parse(await readFile(join(data, "configuration-revisions", `${revision}.json`), "utf8")));
      const { warnings: _warnings, ...identity } = saved.effective;
      if (saved.revision !== revision || hash({ config: saved.config, effective: identity }) !== revision) throw new Error("Invalid revision");
      return saved;
    } catch { throw Object.assign(new Error("Pi 配置版本不可用；不能替换为当前设置。"), { code: "unavailable" }); }
  }
  async function archive() {
    const current = await view(), directory = join(data, "configuration-revisions");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try { await writeJournal(join(directory, `${current.revision}.json`), current, true); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; return archived(current.revision); }
    return current;
  }
  async function snapshot(revision?: string): Promise<ConfigurationSnapshot> {
    const current = revision ? await archived(revision) : await view();
    const options = adapterOptions(host);
    // Preserve Pi's default-profile semantics (including creation on first use).
    // Turning the inherited default into an explicit --agent-dir would wrongly
    // require an existing private directory and disable Pi's normal defaults.
    if (current.effective.profileSource !== "default.HOME/.pi/agent") options.agentDir = current.effective.profile;
    else if (revision) {
      const inherited = selectedProfile({}, options).profile;
      const actual = await realpath(resolve(inherited)).catch(() => resolve(inherited));
      if (actual !== current.effective.profile) throw Object.assign(new Error("Pi default profile changed from the admitted revision"), { code: "unavailable" });
    }
    if (current.effective.model) options.model = current.effective.model;
    if (current.effective.thinking) options.thinking = current.effective.thinking;
    return { ...current, options };
  }
  return { configure, models: async () => discoverModels((await view()).effective), snapshot, archive };
}
