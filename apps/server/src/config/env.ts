import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().default("0.0.0.0"),
  PORT: z
    .string()
    .default("3101")
    .refine((v) => /^\d+$/.test(v) && Number.isFinite(Number(v)), {
      message: "PORT must be a valid integer string",
    }),
  DATABASE_URL: z.string().default("file:./prisma/dev.db"),
  ALLOWED_ORIGINS: z.string().default("*"),
  API_KEY: z.string().optional(),
  CHRONA_WEB_DIST: z.string().optional(),
});

type Env = z.output<typeof envSchema>;

let cachedEnv: Env | null = null;

export function readEnv(): Env {
  if (cachedEnv) return cachedEnv;
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
  if (!env.ALLOWED_ORIGINS || env.ALLOWED_ORIGINS === "*") return ["*"];
  return env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
}

