import { expect, test } from "bun:test";
import bridge from "../../../../../external-plugins/pi-steward-agent/chrona-tools";

test("Pi bridge surfaces structured HTTP errors and redacts capability", async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.CHRONA_AGENT_URL, oldToken = process.env.CHRONA_AGENT_TOKEN;
  process.env.CHRONA_AGENT_URL = "http://127.0.0.1:1234/api/steward-agent";
  process.env.CHRONA_AGENT_TOKEN = "secret-capability";
  let execute: ((id: string, params: unknown) => Promise<unknown>) | undefined;
  globalThis.fetch = (async (url: string | URL | Request) => String(url).endsWith("/catalog")
    ? Response.json({ tools: [{ name: "chrona_schedules", description: "schedules", parameters: {} }] })
    : Response.json({ ok: false, error: { code: "invalid", message: "Use chrona_focus first secret-capability" } }, { status: 400 })) as typeof fetch;
  try {
    await bridge({ registerTool(tool) { execute = tool.execute; } });
    await expect(execute!("one", {})).rejects.toThrow("invalid: Use chrona_focus first [redacted]");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.CHRONA_AGENT_URL; else process.env.CHRONA_AGENT_URL = oldUrl;
    if (oldToken === undefined) delete process.env.CHRONA_AGENT_TOKEN; else process.env.CHRONA_AGENT_TOKEN = oldToken;
  }
});
