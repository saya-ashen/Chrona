import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { CHRONA_TOOLS, type ProviderRunInput } from "@chrona/contracts/steward";
import { readPiResources, resourceCommand, resourceVersionError, type PiResources } from "./pi-resources";

export type PiProviderOptions = {
  command?: string; agentDir?: string; expectedVersion?: string; model?: string; resourcesFile?: string;
  chronaExtension: string; webExtension?: string | null; agentUrl: string; bwrap?: string | null;
  workspaceRoot?: string; dataDir?: string;
  /** End a run whose Pi RPC stream is silent this long outside tool runs and user questions (default 5 min). */
  idleTimeoutMs?: number;
};
export type PiLaunchConfig = {
  options: PiProviderOptions; command: string; agentDir: string; version: string;
  extension: string; web: string | null; bwrap: string | null; resources: PiResources; resourceError: string | null;
};
const supportedVersions = new Set(["0.85.0", "1.3.0"]);
const inside = (parent: string, child: string) => { const path = relative(parent, child); return path === "" || path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path); };
export const profileOverlaps = (profile: string, work: string) => inside(profile, work) || inside(work, profile);

/** No PATH fallback or inheritance of the interactive user's Pi resource profile. */
export function piLaunchConfig(options: PiProviderOptions): PiLaunchConfig {
  const selected = readPiResources(options.resourcesFile, options.agentDir ?? "", options.workspaceRoot);
  return { options, command: options.command ?? "", agentDir: options.agentDir ?? "", version: options.expectedVersion ?? "0.85.0", resources: selected.resources, resourceError: selected.error,
    extension: resolve(options.chronaExtension), web: options.webExtension ? resolve(options.webExtension) : null,
    bwrap: options.bwrap ? (options.bwrap.includes("/") ? resolve(options.bwrap) : options.bwrap) : null };
}
function privateProfile(path: string): boolean {
  try {
    const stat = statSync(path);
    return stat.isDirectory() && realpathSync(path) === path && (process.platform === "win32" || (stat.mode & 0o077) === 0);
  } catch { return false; }
}
function configurationError(config: PiLaunchConfig): string | null {
  if (!isAbsolute(config.command)) return "Configure an absolute, service-specific Pi executable";
  if (!isAbsolute(config.agentDir) || !privateProfile(config.agentDir)) return "Pi profile must be an existing private canonical directory";
  if (config.options.workspaceRoot && profileOverlaps(config.agentDir, resolve(config.options.workspaceRoot))) return "Pi profile must be separate from the session workspace";
  if (!supportedVersions.has(config.version)) return "Unsupported Pi version pin";
  if (config.resourceError) return config.resourceError;
  const resourceError = resourceVersionError(config.resources, config.version, !!config.bwrap);
  if (resourceError) return resourceError;
  if (!existsSync(config.extension)) return "Chrona tools extension missing";
  if (config.web && !existsSync(config.web)) return "Pi web extension missing";
  return null;
}
/** Chrona/QQ/database secrets are not inherited. Pi's own model credentials remain its responsibility. */
export function piEnvironment(config: PiLaunchConfig): NodeJS.ProcessEnv {
  const allowed = ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "MISTRAL_API_KEY", "CEREBRAS_API_KEY"];
  return { ...Object.fromEntries(allowed.flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]])), PI_CODING_AGENT_DIR: config.agentDir };
}
async function probe(command: string, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; version: string }> {
  return new Promise(resolveProbe => {
    let output = "";
    try {
      const child = spawn(command, ["--version"], { env, stdio: ["ignore", "pipe", "ignore"], shell: false });
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      child.stdout.on("data", (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-256); });
      child.once("error", () => { clearTimeout(timer); resolveProbe({ ok: false, version: "" }); });
      child.once("close", code => { clearTimeout(timer); resolveProbe({ ok: code === 0, version: output.trim() }); });
    } catch { resolveProbe({ ok: false, version: "" }); }
  });
}
export async function inspectPiLaunch(config: PiLaunchConfig): Promise<string | null> {
  const invalid = configurationError(config);
  if (invalid) return invalid;
  const env = piEnvironment(config), pi = await probe(config.command, env);
  if (!pi.ok) return "Pi binary unavailable";
  if (pi.version !== config.version) return "Pi version does not match the configured pin";
  if (config.bwrap && !(await probe(config.bwrap, env)).ok) return "bubblewrap binary unavailable";
  return null;
}
const both = (p: string) => { const path = resolve(p); return existsSync(path) ? [path, realpathSync(path)] : [path]; };
/** User-approved host paths are writable; Chrona's data dir is re-masked so a grant of e.g. home cannot reach approvals. */
function hostMounts(config: PiLaunchConfig, input: ProviderRunInput) {
  const granted = (input.hostPaths ?? []).filter(p => isAbsolute(p) && existsSync(p)).flatMap(p => ["--bind", p, p]);
  const data = granted.length && config.options.dataDir ? [...new Set(both(config.options.dataDir))] : [];
  return [...granted, ...data.flatMap(p => ["--tmpfs", p])];
}
function workspaceMounts(input: ProviderRunInput, cwd: string) {
  if (realpathSync(cwd) !== cwd || realpathSync(resolve(input.sessionDir)) !== resolve(input.sessionDir)) throw new Error("Unsafe session directory");
  return ["--bind", cwd, cwd, "--bind", resolve(input.sessionDir), resolve(input.sessionDir)];
}
export function piArguments(config: PiLaunchConfig, input: ProviderRunInput, prompt: string) {
  const args = ["--mode", "rpc", "--session-dir", resolve(input.sessionDir), "--session-id", input.sessionId ?? randomUUID(),
    "--no-approve", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "-e", config.extension];
  if (config.web) args.push("-e", config.web);
  // --no-extensions also drops Pi's built-in tool search; deferred module tools need it.
  if (input.searchTools) args.push("-e", "builtin:tool-search");
  for (const extension of config.resources.extensions) args.push("-e", extension);
  for (const skill of config.resources.skills) args.push("--skill", skill);
  args.push("--tools", [...new Set(["read", "edit", "write", "grep", "find", "ls", ...(config.bwrap ? ["bash"] : []), ...CHRONA_TOOLS, ...(config.web ? ["web_search", "fetch_content"] : []), ...config.resources.tools, ...(input.extraTools ?? []).filter(name => /^m_[a-z0-9_]{1,62}$/.test(name)),
    // An exact name declares a tool up front; only the pattern keeps deferred module tools behind tool_search (Pi 1.3).
    ...(input.searchTools ? ["tool_search", "m_*"] : [])])].join(","), "--append-system-prompt", `${prompt}\nThis is a ${input.lane} run.`);
  if (config.options.model) args.push("--model", config.options.model);
  if (!config.bwrap) return args;
  const cwd = resolve(input.cwd);
  // Parent masks precede child masks; all masks precede the explicit resource/workspace mounts.
  const hidden = [...new Set([homedir(), config.options.dataDir].filter((p): p is string => !!p).flatMap(both))]
    .sort((a, b) => a.split(sep).length - b.split(sep).length);
  const resources = [config.command, config.extension, config.web, ...config.resources.extensions, ...config.resources.skills]
    .filter((p): p is string => !!p && isAbsolute(p));
  const visible = [...new Set(resources.flatMap(p => existsSync(p) ? [p, realpathSync(p)] : [p]))]
    .filter(p => hidden.some(root => inside(root, p)));
  // A private root (host entries bound read-only) lets /content exist without touching the host.
  const root = readdirSync("/").filter(name => !["proc", "dev", "tmp", "content"].includes(name)).flatMap(name => ["--ro-bind", `/${name}`, `/${name}`]);
  return ["--die-with-parent", "--tmpfs", "/", ...root, "--tmpfs", "/tmp", ...hidden.flatMap(p => ["--tmpfs", p]),
    ...hostMounts(config, input),
    "--dev", "/dev", "--proc", "/proc", ...visible.flatMap(p => ["--ro-bind", p, p]), ...workspaceMounts(input, cwd),
    "--dir", "/content", ...(input.content ?? []).flatMap(area => {
      if (!/^[a-z][a-z0-9-]{1,40}$/.test(area.name) || !isAbsolute(area.dir) || realpathSync(area.dir) !== area.dir) throw new Error("Unsafe content mount");
      return [area.writable ? "--bind" : "--ro-bind", area.dir, `/content/${area.name}`];
    }),
    "--bind", config.agentDir, config.agentDir, "--remount-ro", "/", "--chdir", cwd, "--", config.command, ...args];
}
/** Detect command resources appended by a wrapper. Not a proof that arbitrary executable code is safe. */
export function expectedPiCommands(config: PiLaunchConfig, commands: unknown): boolean {
  if (!Array.isArray(commands)) return false;
  const base = [config.extension, config.web].filter((path): path is string => path !== null);
  return commands.every(command => command && typeof command === "object" && resourceCommand(config.resources, command.source, command.sourceInfo?.path ?? command.path, base));
}
