import { NextResponse } from "next/server";
import type { AiClientType, LLMClientConfig, OpenClawClientConfig } from "@chrona/ai-features";

async function testOpenClaw(config: OpenClawClientConfig) {
  if (!config.bridgeUrl) {
    return { available: false, reason: "Bridge URL is required" };
  }

  try {
    const res = await fetch(`${config.bridgeUrl}/v1/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return {
        available: false,
        reason: `Bridge health endpoint returned ${res.status}`,
      };
    }
    const body = (await res.json()) as { status?: string };
    if (body.status !== "ok") {
      return {
        available: false,
        reason: `Bridge health status was ${body.status ?? "unknown"}`,
      };
    }
    return { available: true, reason: "Bridge is reachable" };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : "Failed to reach bridge",
    };
  }
}

function testLlm(config: LLMClientConfig) {
  if (!config.baseUrl) {
    return { available: false, reason: "Base URL is required" };
  }
  if (!config.apiKey) {
    return { available: false, reason: "API key is required" };
  }
  return { available: true, reason: "LLM configuration looks valid" };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, config } = body ?? {};

    if (!type || (type !== "openclaw" && type !== "llm")) {
      return NextResponse.json({ ok: false, error: "type must be 'openclaw' or 'llm'" }, { status: 400 });
    }

    const result = type === "openclaw"
      ? await testOpenClaw((config ?? {}) as OpenClawClientConfig)
      : testLlm((config ?? {}) as LLMClientConfig);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to test client";
    return NextResponse.json({ ok: false, available: false, reason: message, error: message }, { status: 500 });
  }
}

