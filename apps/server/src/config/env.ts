import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { applyChronaRuntimeConfigToEnv } from "@chrona/shared/runtime-config";
import { isExactLoopbackHost, normalizeNetworkHost } from "@chrona/providers-foundation";


const envSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z
    .string()
    .default("3101")
    .refine((v) => /^\d+$/.test(v) && Number.isFinite(Number(v)), {
      message: "PORT must be a valid integer string",
    }),
  DATABASE_URL: z.string().default("file:./prisma/dev.db"),
  ALLOWED_ORIGINS: z.string().optional(),
  API_KEY: z.string().optional(),
  CHRONA_UNSAFE_PUBLIC_BIND: z.string().optional(),
  CHRONA_UNSAFE_CORS: z.string().optional(),
  CHRONA_WEB_DIST: z.string().optional(),
  CHRONA_EXPERIMENTAL_DASHBOARD_AI_SUMMARY: z.string().optional(),
  CHRONA_EMAIL_TRIGGER_SECRET: z.string().min(16).optional(),
});

type Env = z.output<typeof envSchema>;

let cachedEnv: Env | null = null;

export function resetEnvCacheForTests(): void {
  if (process.env.NODE_ENV === "test") {
    cachedEnv = null;
  }
}

export function readEnv(): Env {
  if (cachedEnv) return cachedEnv;
  applyChronaRuntimeConfigToEnv(process.env);
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${errors}`);
  }
  cachedEnv = result.data;
  return cachedEnv;
}

export function resolvePort(env: Env): number {
  const port = Number(env.PORT);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a valid port number, got: ${env.PORT}`);
  }
  return port;
}

export function resolveAllowedOrigins(env: Env): string[] {
  const value = env.ALLOWED_ORIGINS?.trim();
  if (!value) return [];
  if (value === "*") {
    if (env.CHRONA_UNSAFE_CORS !== "1") {
      throw new Error(
        "ALLOWED_ORIGINS=* requires the explicit CHRONA_UNSAFE_CORS=1 override.",
      );
    }
    return ["*"];
  }
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
}

export function isTrustedRequestOrigin(
  requestUrl: string,
  origin: string | undefined,
  allowedOrigins: string[],
): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes("*")) return true;
  if (allowedOrigins.includes(origin)) return true;
  return origin === new URL(requestUrl).origin;
}

function isLoopbackAddress(address: string): boolean {
  const normalized = normalizeNetworkHost(address);
  if (isExactLoopbackHost(normalized)) return true;
  return isIP(normalized) === 6 && /^::ffff:127(?:\.\d{1,3}){3}$/.test(normalized);
}

/**
 * Resolves every hostname address and accepts only hosts whose entire address
 * set is loopback. Resolution failures deliberately fail closed.
 */
export async function isLoopbackBindHost(host: string): Promise<boolean> {
  const normalized = normalizeNetworkHost(host);
  if (isIP(normalized)) return isLoopbackAddress(normalized);

  try {
    const addresses = await lookup(normalized, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(({ address }) => isLoopbackAddress(address));
  } catch {
    return false;
  }
}

export async function assertSafeBind(env: Env): Promise<void> {
  if (env.API_KEY || env.CHRONA_UNSAFE_PUBLIC_BIND === "1") return;
  if (await isLoopbackBindHost(env.HOST)) return;

  throw new Error(
    [
      `Refusing to start Chrona on non-loopback HOST=${env.HOST} without API_KEY.`,
      "This exposes your local Chrona API to your network.",
      "Set API_KEY, bind to a loopback address, or explicitly set CHRONA_UNSAFE_PUBLIC_BIND=1 to allow an unsafe public binding.",
    ].join(" "),
  );
}

export async function isUnsafePublicBindOverride(env: Env): Promise<boolean> {
  return !env.API_KEY
    && env.CHRONA_UNSAFE_PUBLIC_BIND === "1"
    && !(await isLoopbackBindHost(env.HOST));
}
