import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ModuleCall, ModuleEvent, ProviderTranscriptItem } from "@chrona/contracts/steward";
import { moduleEventReplySchema } from "@chrona/contracts/steward";
import { PI_TRANSCRIPT_MAX_BYTES, type PiTranscriptPage } from "@chrona/pi";
import { createModuleChannel } from "../../module-channel";

const now = "2026-11-11T00:00:00.000Z";
test("actual SDK keeps the same live Pi host responsive after oversized transcript; pages preserve the complete UTF-8 transcript", async () => {
  const data = await mkdtemp("/tmp/chrona-pi-transcript-sdk-");
  const calls: ModuleCall[] = [];
  const channel = await createModuleChannel({ async onCall(call) {
    calls.push(call); return { id: call.id, result: { output: {} } };
  } });
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const profile = join(data, "profile"), sessions = join(data, "sessions"), hugeSessions = join(data, "huge-sessions");
    await mkdir(profile); await mkdir(sessions); await mkdir(hugeSessions);
    const recent: ProviderTranscriptItem = { at: now, kind: "text", text: "recent visible answer 检查🙂" };
    await writeFile(join(hugeSessions, "oversized.jsonl"), JSON.stringify({ type: "message", message: { role: "user", content: "🙂".repeat(300000) } }) + "\n" + JSON.stringify({ type: "message", timestamp: now, message: { role: "assistant", content: recent.text } }) + "\n");
    await writeFile(join(profile, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "fixture" }));
    const expected: ProviderTranscriptItem[] = Array.from({ length: 93 }, (_, i) => ({ at: now, kind: "text", text: `${i}:检查🙂` + "转录内容".repeat(260) }));
    expect(Buffer.byteLength(JSON.stringify(expected))).toBeGreaterThan(262144);
    expect(moduleEventReplySchema.parse({ id: "large", result: { result: expected } })).toEqual({ id: "large", result: { result: expected } });
    let offset = 0;
    const records = expected.map(item => {
      const record = JSON.stringify({ type: "message", timestamp: item.at, message: { role: "assistant", content: [{ type: "text", text: item.kind === "text" ? item.text : "" }] } }) + "\n";
      item.id = `fixture.jsonl:${offset}:0`;
      offset += Buffer.byteLength(record);
      return record;
    });
    await writeFile(join(sessions, "fixture.jsonl"), records.join(""));
    recent.id = `oversized.jsonl:${Buffer.byteLength(JSON.stringify({ type: "message", message: { role: "user", content: "🙂".repeat(300000) } }) + "\n")}:0`;
    child = Bun.spawn([process.execPath, "--no-install", join(import.meta.dir, "transcript-sdk.fixture.ts")], {
      cwd: resolve(import.meta.dir, "../../../../../../.."), stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, CHRONA_IPC_ENDPOINT: channel.endpoint, CHRONA_IPC_TOKEN: channel.token, CHRONA_DATA: data,
        CHRONA_MODULE_BINDINGS: JSON.stringify({ web: "web-fixture" }),
        CHRONA_PROVIDER_CONFIGURATION: JSON.stringify({ agentDir: profile, chronaExtension: "/fixture/bridge", agentUrl: "http://fixture.invalid" }), CHRONA_PROVIDER_MODEL_ENV: "{}" },
    });
    const event = (id: string, args: Record<string, unknown>): ModuleEvent => ({ now, params: {}, bindings: { web: "web-fixture" }, trigger: { kind: "tool", id, firedAt: now, args, caller: { kind: "kernel" } } });
    async function tool(id: string, args: Record<string, unknown>) {
      const reply = await channel.send(event(id, args), 2000);
      expect(moduleEventReplySchema.safeParse(reply).success).toBe(true);
      return reply;
    }
    const activation = await channel.send({ now, params: {}, bindings: { web: "web-fixture" }, trigger: { kind: "activated", id: "activated", firedAt: now } }, 5000);
    expect(activation).toHaveProperty("result");
    const registration = calls.find(call => call.method === "call" && call.params.target === "agent.register");
    if (!registration || registration.method !== "call") throw new Error("Pi did not register");
    const revision = (registration.params.args.configuration as { revision: string }).revision;
    const operationId = "live-during-transcript";
    const request = { configurationRevision: revision, operationId, runId: "fixture-run", token: "fixture-token", callbacks: "00000000-0000-4000-8000-000000000001", lane: "foreground", cwd: data, sessionDir: sessions, sessionId: null, prompt: "fixture", systemPrompt: "", resources: "configured", deadline: null };
    expect(await tool("start", request)).toMatchObject({ result: { result: { operationId } } });
    const bounded = await tool("transcript", { sessionDir: sessions, limit: 300 });
    if ("error" in bounded) throw new Error(bounded.error);
    const tail = bounded.result.result as ProviderTranscriptItem[];
    expect(tail[0]).toMatchObject({ kind: "text", text: expect.stringContaining("[Pi transcript gap]") });
    expect(tail.length).toBeGreaterThan(1);
    expect(tail.slice(1)).toEqual(expected.slice(-(tail.length - 1)));
    expect(Buffer.byteLength(JSON.stringify(tail))).toBeLessThanOrEqual(PI_TRANSCRIPT_MAX_BYTES);
    const recentReply = await tool("transcript", { sessionDir: hugeSessions, limit: 300 });
    if ("error" in recentReply) throw new Error(recentReply.error);
    const recentTail = recentReply.result.result as ProviderTranscriptItem[];
    expect(recentTail).toHaveLength(2);
    expect(recentTail[0]).toMatchObject({ kind: "text", text: expect.stringContaining("Earlier source content was not inspected") });
    expect(recentTail[1]).toEqual(recent);
    expect(Buffer.byteLength(JSON.stringify(recentTail))).toBeLessThanOrEqual(PI_TRANSCRIPT_MAX_BYTES);
    expect(await tool("status", { operationId })).toMatchObject({ result: { result: { operationId, outcome: null, failure: false } } });
    await channel.ping(1000);
    const received: ProviderTranscriptItem[] = [];
    let cursor: string | undefined, pages = 0;
    do {
      const reply = await tool("transcript", { sessionDir: sessions, limit: 300, page: true, ...(cursor ? { cursor } : {}) });
      if ("error" in reply) throw new Error(reply.error);
      const page = reply.result.result as unknown as PiTranscriptPage;
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(PI_TRANSCRIPT_MAX_BYTES);
      expect(page.gaps).toEqual([]); received.push(...page.items);
      expect(await tool("status", { operationId })).toMatchObject({ result: { result: { outcome: null, failure: false } } });
      cursor = page.nextCursor ?? undefined;
      if (++pages > 10) throw new Error("Pagination did not finish");
    } while (cursor);
    expect(pages).toBeGreaterThan(1); expect(received).toEqual(expected);
    expect(await tool("native", { operationId, request: { type: "fixture_identity" } })).toMatchObject({ result: { result: { response: { starts: 1 } } } });
    expect(await tool("abort", { operationId })).toMatchObject({ result: { result: { requested: true } } });
    let status = await tool("status", { operationId });
    for (let attempt = 0; attempt < 100 && "result" in status && !(status.result.result as { outcome: unknown }).outcome; attempt++) {
      await Bun.sleep(5); status = await tool("status", { operationId });
    }
    expect(status).toMatchObject({ result: { result: { outcome: { outcome: "failed", error: "Fixture aborted" }, failure: false } } });
    await channel.ping(1000);
    expect(channel.connected()).toBe(true); expect(channel.diagnostics()).toEqual([]);
    expect(child.exitCode).toBeNull();
  } finally {
    await channel.close();
    if (child) { child.kill(); await child.exited; }
    await rm(data, { recursive: true, force: true });
  }
}, 15000);
