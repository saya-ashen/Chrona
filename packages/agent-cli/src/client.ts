import type { AgentControlActionBody } from "@chrona/contracts";

export interface ChronaAgentEnv {
  CHRONA_BASE_URL?: string;
  CHRONA_RUN_TOKEN?: string;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface SendOptions {
  env: ChronaAgentEnv;
  fetchImpl: FetchLike;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

function endpointFromEnv(env: ChronaAgentEnv) {
  const baseUrl = env.CHRONA_BASE_URL?.trim();
  const token = env.CHRONA_RUN_TOKEN?.trim();
  const missing = [baseUrl ? "" : "CHRONA_BASE_URL", token ? "" : "CHRONA_RUN_TOKEN"].filter(Boolean);
  if (missing.length > 0) {
    throw new ConfigError(`Missing ${missing.join(" and ")}. Chrona agent commands require CHRONA_BASE_URL and CHRONA_RUN_TOKEN.`);
  }
  return { url: `${stripTrailingSlashes(baseUrl!)}/agent/control`, token: token! };
}

export async function sendControlAction(body: AgentControlActionBody, options: SendOptions) {
  const endpoint = endpointFromEnv(options.env);
  const response = await options.fetchImpl(endpoint.url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${endpoint.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Chrona control request failed (${response.status}): ${text || response.statusText}`);
  }
  return text ? JSON.parse(text) as unknown : { ok: true };
}
