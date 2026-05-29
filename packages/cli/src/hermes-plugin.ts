import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type InstallHermesPluginOptions = {
  hermesHome?: string;
  mcpUrl?: string;
  pluginDir?: string;
  skipEnable?: boolean;
};

export type HermesPluginConfig = {
  mcpUrl?: string;
  pluginVersion?: string;
};

export type HermesPluginInstallResult = {
  enabled: boolean;
  installDir: string;
  mcpUrl: string;
  pluginVersion: string;
};

export const DEFAULT_CHRONA_MCP_URL = "http://127.0.0.1:3101/api/mcp";
export const HERMES_PLUGIN_CONFIG_FILE = "chrona_config.json";

const packageDir = process.env.CHRONA_PACKAGE_DIR
  ?? resolve(dirname(import.meta.dirname), "..");

export function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
}

export function getHermesHome(hermesHome?: string): string {
  return hermesHome ?? process.env.HERMES_HOME ?? join(getHome(), ".hermes");
}

export function getHermesPluginDir(options: Pick<InstallHermesPluginOptions, "hermesHome" | "pluginDir"> = {}): string {
  return options.pluginDir
    ?? process.env.CHRONA_HERMES_PLUGIN_DIR
    ?? join(getHermesHome(options.hermesHome), "plugins", "chrona");
}

export function getHermesPluginConfigPath(pluginDir: string): string {
  return join(pluginDir, HERMES_PLUGIN_CONFIG_FILE);
}

function readPluginYamlVersion(pluginDir: string): string | undefined {
  const pluginYamlPath = join(pluginDir, "plugin.yaml");
  if (!existsSync(pluginYamlPath)) return undefined;

  for (const line of readFileSync(pluginYamlPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("version:")) return trimmed.slice("version:".length).trim();
  }
  return undefined;
}

export function findHermesPluginSourceDir(): string {
  const candidates = [
    process.env.CHRONA_HERMES_PLUGIN_SOURCE_DIR,
    process.env.CHRONA_RESOURCE_DIR
      ? join(process.env.CHRONA_RESOURCE_DIR, "external-plugins", "hermes")
      : undefined,
    join(dirname(Bun.argv[0] ?? process.execPath), "resources", "external-plugins", "hermes"),
    join(packageDir, "external-plugins", "hermes"),
    resolve(process.cwd(), "external-plugins", "hermes"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "plugin.yaml"))) {
      return candidate;
    }
  }

  throw new Error("Chrona Hermes plugin source files were not found.");
}

export function getBundledHermesPluginVersion(): string {
  const sourceDir = findHermesPluginSourceDir();
  const version = readPluginYamlVersion(sourceDir);
  if (!version) {
    throw new Error("Chrona Hermes plugin version was not found.");
  }
  return version;
}

export function readHermesPluginConfig(pluginDir: string): HermesPluginConfig | undefined {
  const configPath = getHermesPluginConfigPath(pluginDir);
  if (!existsSync(configPath)) return undefined;

  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as HermesPluginConfig;
    return typeof config === "object" && config !== null ? config : undefined;
  } catch {
    return undefined;
  }
}

export function writeHermesPluginConfig(pluginDir: string, config: HermesPluginConfig): void {
  writeFileSync(
    getHermesPluginConfigPath(pluginDir),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
}

export function isHermesPluginInstalled(pluginDir = getHermesPluginDir()): boolean {
  return existsSync(join(pluginDir, "plugin.yaml"));
}

export function getInstalledHermesPluginVersion(pluginDir = getHermesPluginDir()): string | undefined {
  return readHermesPluginConfig(pluginDir)?.pluginVersion ?? readPluginYamlVersion(pluginDir);
}

export function isHermesCliAvailable(): boolean {
  try {
    const result = Bun.spawnSync(["hermes", "--version"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function copyHermesPluginFile(sourceDir: string, installDir: string, fileName: string): void {
  copyFileSync(join(sourceDir, fileName), join(installDir, fileName));
}

function enableHermesPlugin(): boolean {
  try {
    const result = Bun.spawnSync(["hermes", "plugins", "enable", "chrona"], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function installHermesPlugin(options: InstallHermesPluginOptions): Promise<HermesPluginInstallResult> {
  const sourceDir = findHermesPluginSourceDir();
  const installDir = getHermesPluginDir(options);
  const mcpUrl = options.mcpUrl ?? process.env.CHRONA_MCP_URL ?? DEFAULT_CHRONA_MCP_URL;
  const pluginVersion = getBundledHermesPluginVersion();

  mkdirSync(installDir, { recursive: true });

  for (const fileName of ["__init__.py", "tools.py", "plugin.yaml", "README.md", "smoke_test.py"]) {
    copyHermesPluginFile(sourceDir, installDir, fileName);
  }

  writeHermesPluginConfig(installDir, { mcpUrl, pluginVersion });

  const enabled = options.skipEnable || process.env.CHRONA_HERMES_SKIP_ENABLE === "1"
    ? false
    : enableHermesPlugin();

  return { enabled, installDir, mcpUrl, pluginVersion };
}
