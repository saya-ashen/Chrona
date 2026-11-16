import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { THINKING_LEVELS, ProviderRunInput } from "@chrona/contracts/steward";
import { modernPi, readPiResources, resourceVersionError, type PiResources } from "./pi-resources";
import { launchPiProcess, type PiProcess, type PiProcessInput } from "./pi-process";

export type PiProviderOptions = {
  command?: string;
  /** Optional default thinking level; run providerOptions take precedence. */
  thinking?: (typeof THINKING_LEVELS)[number];
  /** User-selected profile; omitted inherits PI_CODING_AGENT_DIR, then Pi's normal HOME/.pi/agent. */
  agentDir?: string;
  expectedVersion?: string; model?: string; resourcesFile?: string; executionMode?: "trusted-local" | "required-isolation";
  chronaExtension: string; webExtension?: string | null; agentUrl: string;
  /** The browser tool (v2-12): its extension, and where runs get a browser from; without either runs have no browser tool. */
  browserExtension?: string | null; browsers?: { ensure(): string | null };
  workspaceRoot?: string;
  /** Opt-in: end a run whose Pi RPC stream is silent this long outside tool runs and user questions. No default. */
  idleTimeoutMs?: number;
  /** Native reply bound, primarily for trusted hosts/tests; no request is retried. Default 30 seconds. */
  nativeTimeoutMs?: number;
  /** Trusted launcher; closed must reject if its owned process tree cannot be proven stopped. */
  launch?: (input: PiProcessInput) => PiProcess;
  /** Absolute guardian resource path supplied by the trusted host. */
  processHelper?: string;
};
export type PiLaunchConfig = {
  options: PiProviderOptions; command: string; agentDir: string; agentDirSource: "option" | "environment" | "default"; version: string;
  extension: string; web: string | null; browserExtension: string | null; resources: PiResources; resourceError: string | null;
};
const inside = (parent: string, child: string) => { const path = relative(parent, child); return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path); };
export const profileOverlaps = (profile: string, work: string) => inside(profile, work) || inside(work, profile);

/** Keep the executable explicit while inheriting the selected user's normal Pi environment. */
export function piLaunchConfig(options: PiProviderOptions): PiLaunchConfig {
  const inherited = process.env.PI_CODING_AGENT_DIR || undefined;
  const agentDirSource = options.agentDir !== undefined ? "option" : inherited ? "environment" : "default";
  const agentDir = options.agentDir ?? inherited ?? join(process.env.HOME || homedir(), ".pi", "agent");
  const selected = readPiResources(options.resourcesFile, agentDir, options.workspaceRoot);
  return { options, command: options.command ?? "", agentDir, agentDirSource, version: options.expectedVersion ?? "0.85.0", resources: selected.resources, resourceError: selected.error,
    extension: resolve(options.chronaExtension), web: options.webExtension ? resolve(options.webExtension) : null,
    browserExtension: options.browserExtension ? resolve(options.browserExtension) : null };
}
function validProfile(config: PiLaunchConfig): boolean {
  if (!isAbsolute(config.agentDir)) return false;
  try {
    const stat = statSync(config.agentDir);
    if (config.agentDirSource === "default") return stat.isDirectory();
    return stat.isDirectory() && realpathSync(config.agentDir) === config.agentDir;
  } catch (error) {
    return config.agentDirSource === "default" && (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}
const isolationError = "Pi required-isolation is no longer supported; configure trusted-local execution";
function configurationError(config: PiLaunchConfig): string | null {
  if (!isAbsolute(config.command)) return "Configure an absolute, service-specific Pi executable";
  if (!validProfile(config)) return config.agentDirSource === "default" ? "Pi default profile must be a directory" : "Pi profile must be an existing canonical directory";
  if (config.options.workspaceRoot && profileOverlaps(config.agentDir, resolve(config.options.workspaceRoot))) return "Pi profile must be separate from the session workspace";
  if (config.version !== "0.85.0" && !modernPi(config.version)) return "Unsupported Pi version pin";
  if (config.resourceError) return config.resourceError;
  const resourceError = resourceVersionError(config.resources, config.version);
  if (resourceError) return resourceError;
  const extensions = [[config.extension, "Chrona tools extension missing"], [config.web, "Pi web extension missing"], [config.browserExtension, "Pi browser extension missing"]] as const;
  return extensions.find(([path]) => path && !existsSync(path))?.[1] ?? null;
}
/** Pi-owned environment transported by the host, including the user's selected profile. */
export const PI_MODEL_ENVIRONMENT_KEYS = ["PI_CODING_AGENT_DIR", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "MISTRAL_API_KEY", "CEREBRAS_API_KEY"] as const;
/** Chrona/QQ/database secrets are not inherited. Pi's own model credentials remain its responsibility. */
export function piEnvironment(config: PiLaunchConfig): NodeJS.ProcessEnv {
  const allowed = ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", ...PI_MODEL_ENVIRONMENT_KEYS];
  return { ...Object.fromEntries(allowed.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]])), HOME: process.env.HOME || homedir(), PI_CODING_AGENT_DIR: config.agentDir };
}
async function probe(config: PiLaunchConfig): Promise<{ ok: boolean; version: string; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const cwd = config.agentDirSource === "default" && !existsSync(config.agentDir) ? process.env.HOME || homedir() : config.agentDir;
    const child = (config.options.launch ?? launchPiProcess)({ file: config.command, args: ["--version"], cwd, env: piEnvironment(config), timeoutMs: 3000, helperPath: config.options.processHelper });
    let output = "";
    const deadline = Date.now() + 3000;
    timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.stdout.on("data", (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-256); });
    child.stderr.resume();
    child.stdin.on("error", () => child.kill("SIGKILL"));
    child.stdin.end();
    const { code, signal } = await child.closed;
    return { ok: Date.now() < deadline && code === 0 && signal === null, version: output.trim() };
  } catch (error) { return { ok: false, version: "", error: error instanceof Error ? error.message : "Pi process supervision unavailable" }; }
  finally { clearTimeout(timer); }
}
type VersionProbe = Awaited<ReturnType<typeof probe>>;
const healthVersions = new WeakMap<NonNullable<PiProviderOptions["launch"]>, {
  key: string; expires: number; result: Promise<VersionProbe>;
}>();
async function healthVersion(config: PiLaunchConfig): Promise<VersionProbe> {
  const launch = config.options.launch ?? launchPiProcess;
  let file;
  try { file = statSync(config.command, { bigint: true, throwIfNoEntry: false }); }
  catch (error) {
    console.error(JSON.stringify({ component: "pi", event: "health_version_stat_failed", error: String(error) }));
    return probe(config);
  }
  if (!file) return probe(config);
  const key = JSON.stringify([config.command, config.agentDir, config.agentDirSource, config.version,
    String(file.dev), String(file.ino), String(file.mode), String(file.size), String(file.mtimeNs), String(file.ctimeNs)]);
  const cached = healthVersions.get(launch);
  if (cached?.key === key && cached.expires > Date.now()) return cached.result;
  // Health is an observation; launch admission still probes afresh. Bound wrapper/dependency staleness to 30 seconds.
  const entry = { key, expires: Date.now() + 30_000, result: probe(config) };
  healthVersions.set(launch, entry);
  const result = await entry.result;
  if ((!result.ok || result.version !== config.version) && healthVersions.get(launch) === entry) healthVersions.delete(launch);
  return result;
}
export async function inspectPiLaunch(config: PiLaunchConfig, reuseHealthVersion = false): Promise<string | null> {
  if (config.options.executionMode === "required-isolation") return isolationError;
  const invalid = configurationError(config);
  if (invalid) return invalid;
  const pi = await (reuseHealthVersion ? healthVersion(config) : probe(config));
  if (!pi.ok) return pi.error ?? "Pi binary unavailable or version probe timed out";
  if (pi.version !== config.version) return "Pi version does not match the configured pin";
  return null;
}
function contentAreas(input: ProviderRunInput) {
  return (input.content ?? []).map(area => {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(area.name) || !isAbsolute(area.dir) || realpathSync(area.dir) !== area.dir) throw new Error("Unsafe content directory");
    return area;
  });
}
/** Content areas appear at <cwd>/content/<name> as host links; writability follows the service user's OS permissions. */
export function prepareContent(input: ProviderRunInput) {
  const root = join(resolve(input.cwd), "content"), areas = contentAreas(input);
  mkdirSync(root, { recursive: true });
  for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isSymbolicLink()) unlinkSync(join(root, entry.name));
  for (const area of areas) if (!existsSync(join(root, area.name))) symlinkSync(area.dir, join(root, area.name), process.platform === "win32" ? "junction" : "dir");
}
function additionalExtensions(config: PiLaunchConfig, input: ProviderRunInput, browser: string | null) {
  const extensions = new Set([config.extension]);
  if (config.web) extensions.add(config.web);
  if (browser && config.browserExtension) extensions.add(config.browserExtension);
  for (const extension of config.resources.extensions) extensions.add(extension);
  if (input.searchTools) extensions.add("builtin:tool-search");
  return extensions;
}
/** `browser`: the executable this run's browser tool uses (v2-12), or null for no browser tool. */
export function piArguments(config: PiLaunchConfig, input: ProviderRunInput, prompt: string, browser: string | null = null) {
  if (config.options.executionMode === "required-isolation") throw new Error(isolationError);
  const args = ["--mode", "rpc", "--session-dir", resolve(input.sessionDir), "--session-id", input.sessionId ?? randomUUID()];
  // The bridge's token-scoped catalog owns admission and direct/deferred exposure.
  // Keep ambient tools active; a CLI --tools list would exclude user/native tools.
  for (const extension of additionalExtensions(config, input, browser)) args.push("-e", extension);
  for (const skill of config.resources.skills) args.push("--skill", skill);
  args.push("--append-system-prompt", prompt);
  const model = input.model ?? config.options.model;
  if (model) args.push("--model", model);
  const thinking = input.providerOptions?.thinking ?? config.options.thinking;
  if (thinking !== undefined) args.push("--thinking", String(thinking));
  return args;
}
