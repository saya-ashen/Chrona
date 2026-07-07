import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

const ENV_CONFIG_FILE = "CHRONA_CONFIG_FILE";

const runtimeConfigSchema = z.object({
  server: z.object({
    host: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    allowedOrigins: z.array(z.string().min(1)).optional(),
    unsafePublicBind: z.boolean().optional(),
  }).optional(),
  database: z.object({
    url: z.string().min(1).optional(),
    migrationsDir: z.string().min(1).optional(),
  }).optional(),
  web: z.object({
    dist: z.string().min(1).nullable().optional(),
  }).optional(),
  security: z.object({
    apiKey: z.string().min(1).nullable().optional(),
  }).optional(),
}).strict();

export type ChronaRuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export type LoadedChronaRuntimeConfig = {
  config: ChronaRuntimeConfig;
  path: string | null;
};

function defaultConfigPath(env: NodeJS.ProcessEnv) {
  return env.XDG_CONFIG_HOME
    ? join(env.XDG_CONFIG_HOME, "chrona", "config.json")
    : join(homedir(), ".config", "chrona", "config.json");
}

function configuredPath(env: NodeJS.ProcessEnv) {
  const explicitPath = env[ENV_CONFIG_FILE]?.trim();
  return explicitPath ? resolve(explicitPath) : defaultConfigPath(env);
}

function parseConfigFile(path: string): ChronaRuntimeConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Chrona config ${path}: ${message}`);
  }

  const parsed = runtimeConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid Chrona config ${path}:\n${details}`);
  }

  return parsed.data;
}

export function loadChronaRuntimeConfig(env: NodeJS.ProcessEnv = process.env): LoadedChronaRuntimeConfig {
  const path = configuredPath(env);
  if (!existsSync(path)) return { config: {}, path: null };
  return { config: parseConfigFile(path), path };
}

function setDefault(env: NodeJS.ProcessEnv, key: string, value: string | number | boolean | null | undefined) {
  if (env[key] !== undefined || value === undefined || value === null) return;
  env[key] = String(value);
}

function unsafePublicBindEnvValue(value: boolean | undefined) {
  if (value === undefined) return undefined;
  return value ? "1" : "0";
}

function configEnvDefaults(config: ChronaRuntimeConfig) {
  return [
    ["HOST", config.server?.host],
    ["PORT", config.server?.port],
    ["ALLOWED_ORIGINS", config.server?.allowedOrigins?.join(",")],
    ["CHRONA_UNSAFE_PUBLIC_BIND", unsafePublicBindEnvValue(config.server?.unsafePublicBind)],
    ["DATABASE_URL", config.database?.url],
    ["CHRONA_MIGRATIONS_DIR", config.database?.migrationsDir],
    ["CHRONA_WEB_DIST", config.web?.dist],
    ["API_KEY", config.security?.apiKey],
  ] as const;
}

export function applyChronaRuntimeConfigToEnv(env: NodeJS.ProcessEnv = process.env): LoadedChronaRuntimeConfig {
  const loaded = loadChronaRuntimeConfig(env);
  const { config } = loaded;

  for (const [key, value] of configEnvDefaults(config)) {
    setDefault(env, key, value);
  }

  return loaded;
}
