import { describe, expect, test } from "bun:test";
import { grantedUses, moduleManifestSchema, moduleCallSchema, moduleEventReplySchema } from "@chrona/contracts/steward";

const manifest = {
  name: "price-watch", entry: "index.ts",
  keepAlive: true,
  effects: ["network"], uses: ["notify.send", "agent.run"], tests: ["test.ts"],
};

describe("module manifest contract", () => {
  test("defaults and all parameter value types", () => {
    expect(moduleManifestSchema.parse(manifest)).toMatchObject({ params: {}, data: { schema: 1 } });
    expect(moduleManifestSchema.parse({ ...manifest, tests: undefined }).tests).toEqual([]);
    expect(moduleManifestSchema.parse({ ...manifest, tests: [] }).tests).toEqual([]);
    const params = { threshold: { type: "number", value: 2100 }, label: { type: "string", value: "watch" }, enabled: { type: "boolean", value: true } } as const;
    expect(moduleManifestSchema.parse({ ...manifest, params }).params).toEqual(params);
    for (const ext of ["ts", "py", "sh"]) expect(moduleManifestSchema.safeParse({ ...manifest, entry: `index.${ext}`, tests: [`test.${ext}`], effects: [] }).success).toBe(true);
  });
  test("rejects inbound triggers: outside sources are modules now (v2-8)", () => {
    expect(moduleManifestSchema.safeParse({ ...manifest, triggers: [{ id: "mail", inbound: { connector: "mailbox" } }] }).success).toBe(false);
  });
  test.each(["unknown required", "duplicate names"])("rejects tools with %s", kind => {
    const tool = { name: "lookup", description: "Lookup", parameters: { type: "object", properties: { query: { type: "string" } }, required: kind === "unknown required" ? ["missing"] : ["query"] },
        output: {}
    };
    expect(moduleManifestSchema.safeParse({ ...manifest, tools: kind === "duplicate names" ? [tool, tool] : [tool] }).success).toBe(false);
  });
  test.each(["migrate.ts", "migrate_v2.py", "migrate-v2.sh"])("accepts data migration %s", migrate => {
    expect(moduleManifestSchema.parse({ ...manifest, data: { schema: 2, migrate } }).data).toEqual({ schema: 2, migrate });
  });
  test.each(["../migrate.ts", "folder/migrate.py", "migrate.js", "migrate", "migrate.v2.ts", ""])("rejects invalid migration name %j", migrate => {
    expect(moduleManifestSchema.safeParse({ ...manifest, data: { schema: 2, migrate } }).success).toBe(false);
  });
  test.each([
    ["number", "2100"], ["number", true], ["string", 2100], ["string", false], ["boolean", "true"], ["boolean", 1],
  ])("rejects %s parameter with %j", (type, value) => {
    expect(moduleManifestSchema.safeParse({ ...manifest, params: { threshold: { type, value } } }).success).toBe(false);
  });
  test.each([
    { triggers: [{ id: "daily", schedule: { kind: "daily", time: "08:00" } }, { id: "daily", schedule: { kind: "daily", time: "08:00" } }] },
    { effects: ["network", "network"] },
    { effects: ["shell"] }, { effects: Array(4).fill("network") },
    { name: "X" }, { entry: "../index.ts" }, { entry: "folder/index.ts" }, { entry: "index.js" },
    { tests: ["../test.ts"] }, { tests: Array(11).fill("test.ts") },
    { triggers: [] }, { triggers: Array(11).fill({ id: "daily", schedule: { kind: "daily", time: "08:00" } }) },
    { triggers: [{ id: "daily", schedule: { kind: "daily", time: "08:00" }, extra: true }] },
    { triggers: [{ id: "daily", schedule: { kind: "every", minutes: 1 } }] },
    { params: { "bad key": { type: "number", value: 1 } } },
    { params: { threshold: { type: "number", value: 1, extra: true } } },
    { params: { label: { type: "string", value: "x".repeat(2001) } } },
    { data: { schema: 0 } }, { data: { schema: 1.5 } }, { data: { schema: 1, extra: true } },
    { extra: true },
  ])("rejects invalid manifest patch %j", patch => {
    expect(moduleManifestSchema.safeParse({ ...manifest, ...patch }).success).toBe(false);
  });
});

const notify = { key: "price", level: "now", title: "Price changed", body: "New price" };
describe("module channel contract", () => {
  test("only routed application calls cross the channel", () => {
    expect(moduleCallSchema.safeParse({ id: "1", method: "call", params: { target: { moduleId: "notify-id", tool: "send" }, args: notify, mode: "async", key: "price" } }).success).toBe(true);
    expect(moduleCallSchema.safeParse({ id: "1", method: "call", params: { target: { moduleId: "agent-id", tool: "complete" }, args: { prompt: "p", maxOutputTokens: 10 } } }).success).toBe(true);
    for (const method of ["notify", "wakeProvider", "model", "secret"]) expect(moduleCallSchema.safeParse({ id: "1", method, params: {} }).success).toBe(false);
  });
  test("event replies default result and preserve JSON beyond the retired 256 KiB cap", () => {
    const result = "x".repeat(256 * 1024 - 2);
    expect(moduleEventReplySchema.parse({ id: "1" })).toEqual({ id: "1", result: {} });
    expect(moduleEventReplySchema.parse({ id: "1", result: { result } })).toEqual({ id: "1", result: { result } });
    expect(moduleEventReplySchema.safeParse({ id: "1", result: { handled: true, result } }).success).toBe(false);
    for (const value of [`${result}x`, "界".repeat(90_000)]) {
      expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(256 * 1024);
      expect(moduleEventReplySchema.parse({ id: "1", result: { result: value } })).toEqual({ id: "1", result: { result: value } });
    }
    expect(moduleEventReplySchema.safeParse({ id: "1", result: { result: () => "not JSON" } }).success).toBe(false);
  });
  test.each([
    { method: "call", params: { target: "notify.send", mode: "async" } }, { method: "call", params: { target: "bad" } },
    { method: "call", params: { target: "notify.send", extra: true } }, { method: "call", params: { target: "notify.send" }, extra: true },
    { method: "network", params: { key: "net" } },
  ])("rejects invalid call %j", call => {
    expect(moduleCallSchema.safeParse({ id: "1", ...call }).success).toBe(false);
  });
  test("secrets stand for the secrets interfaces without inferring other uses", () => {
    expect(grantedUses({ uses: ["files.read"], secrets: ["qq_bot"] }).sort()).toEqual(["files.read", "secrets.authorize", "secrets.get", "secrets.token"]);
    expect(moduleManifestSchema.parse(manifest).uses).toEqual(manifest.uses);
  });
  test.each([
    { channel: "chrona_qqbot" }, { dynamicSchedules: true },
    { settings: {} }, { healthCheck: false }, { healthCheck: true },
    { contributes: { events: { emits: [{ name: "updated" }] } } },
    { contributes: { events: "x".repeat(33 * 1024) } },
    { contributes: { "Bad Name": 1 } },
  ])("rejects retired manifest fields instead of normalizing %j", patch => {
    const parsed = moduleManifestSchema.safeParse({ ...manifest, ...patch });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({ code: "unrecognized_keys", keys: Object.keys(patch) }));
  });
  test.each(["model", "wake_provider", "notify_user"])("rejects retired effect %s instead of inferring uses", effect => {
    expect(moduleManifestSchema.safeParse({ ...manifest, effects: [effect, "network"] }).success).toBe(false);
  });
});
