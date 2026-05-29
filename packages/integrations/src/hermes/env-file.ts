import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { getHermesHome } from "./plugin.js";

export type EnvFileEntry = {
  key: string;
  value: string;
};

export function getHermesEnvPath(hermesHome?: string): string {
  return join(getHermesHome(hermesHome), ".env");
}

function parseEnvLine(line: string): EnvFileEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const separator = trimmed.indexOf("=");
  if (separator <= 0) return null;

  return {
    key: trimmed.slice(0, separator).trim(),
    value: trimmed.slice(separator + 1).trim(),
  };
}

export function readHermesEnv(hermesHome?: string): Record<string, string> {
  const envPath = getHermesEnvPath(hermesHome);
  if (!existsSync(envPath)) return {};

  const entries: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const entry = parseEnvLine(line);
    if (entry) entries[entry.key] = entry.value;
  }
  return entries;
}

export function getHermesEnvApiKey(hermesHome?: string): string | undefined {
  const apiKey = readHermesEnv(hermesHome).API_SERVER_KEY.trim();
  return apiKey || undefined;
}

export function writeHermesEnvValues(
  values: Record<string, string>,
  hermesHome?: string,
): { envPath: string; changed: boolean } {
  const envPath = getHermesEnvPath(hermesHome);
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lines = existing ? existing.split("\n") : [];
  const seen = new Set<string>();
  let changed = false;

  const nextLines = lines.map((line) => {
    const entry = parseEnvLine(line);
    if (!entry || !(entry.key in values)) return line;

    seen.add(entry.key);
    const nextLine = `${entry.key}=${values[entry.key]}`;
    if (line !== nextLine) changed = true;
    return nextLine;
  });

  for (const [key, value] of Object.entries(values)) {
    if (seen.has(key)) continue;
    nextLines.push(`${key}=${value}`);
    changed = true;
  }

  if (!changed && existsSync(envPath)) return { envPath, changed: false };

  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, `${nextLines.filter(Boolean).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(envPath, 0o600);
  return { envPath, changed: true };
}
