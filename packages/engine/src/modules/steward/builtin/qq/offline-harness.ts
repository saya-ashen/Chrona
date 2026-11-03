// Offline integration entry used only by regression-test.ts. Never the production entry.
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "chrona";
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url === "https://bots.qq.com/app/getAppAccessToken") return Response.json({ access_token: "fake-test-token", expires_in: 7200 });
  if (url === "https://api.sgroup.qq.com/gateway") return Response.json({ url: "wss://offline.invalid" });
  if (url === "https://api.sgroup.qq.com/v2/users/owner/messages") {
    await appendFile(join(paths.data, "offline-payloads.jsonl"), String(init?.body) + "\n");
    return Response.json({ id: "offline-receipt" });
  }
  throw new Error("Offline test forbids all other requests");
}) as typeof fetch;
globalThis.WebSocket = class { readyState = 0; send() {} close() {} addEventListener() {} } as any;
await import("./index");
