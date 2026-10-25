import { describe, expect, test } from "bun:test";
import { createScheduleSchema, grantedUses, DEFAULT_POLICY, moduleManifestSchema, moduleCallSchema, moduleEventReplySchema, scheduleSchema, chronaToolInputSchemas } from "@chrona/contracts/steward";
import { decidePolicy } from "./policy";

const manifest = {
  name: "price-watch", entry: "index.ts",
  triggers: [{ id: "daily", schedule: { kind: "daily", time: "08:00" } }],
  effects: ["notify_user", "wake_provider", "network"], tests: ["test.ts"],
};

describe("module manifest contract", () => {
  test("defaults and all parameter value types", () => {
    expect(moduleManifestSchema.parse(manifest)).toMatchObject({ params: {}, data: { schema: 1 } });
    const params = { threshold: { type: "number", value: 2100 }, label: { type: "string", value: "watch" }, enabled: { type: "boolean", value: true } } as const;
    expect(moduleManifestSchema.parse({ ...manifest, params }).params).toEqual(params);
    for (const ext of ["ts", "py", "sh"]) expect(moduleManifestSchema.safeParse({ ...manifest, entry: `index.${ext}`, tests: [`test.${ext}`], effects: [] }).success).toBe(true);
  });
  test("rejects inbound triggers: outside sources are modules now (v2-8)", () => {
    expect(moduleManifestSchema.safeParse({ ...manifest, triggers: [{ id: "mail", inbound: { connector: "mailbox" } }] }).success).toBe(false);
  });
  test.each(["unknown required", "duplicate names"])("rejects tools with %s", kind => {
    const tool = { name: "lookup", description: "Lookup", parameters: { type: "object", properties: { query: { type: "string" } }, required: kind === "unknown required" ? ["missing"] : ["query"] } };
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
    { triggers: [manifest.triggers[0], manifest.triggers[0]] },
    { effects: ["notify_user", "notify_user"] }, { effects: ["network", "network"] },
    { effects: ["shell"] }, { effects: Array(4).fill("network") },
    { name: "X" }, { entry: "../index.ts" }, { entry: "folder/index.ts" }, { entry: "index.js" },
    { tests: [] }, { tests: ["../test.ts"] }, { tests: Array(11).fill("test.ts") },
    { triggers: [] }, { triggers: Array(11).fill(manifest.triggers[0]) },
    { triggers: [{ ...manifest.triggers[0], extra: true }] },
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
  test("only routed calls cross the channel (v2-10): notify, wake and model are system interfaces", () => {
    expect(moduleCallSchema.safeParse({ id: "1", method: "call", params: { target: "notify.send", args: notify, mode: "async", key: "price" } }).success).toBe(true);
    expect(moduleCallSchema.safeParse({ id: "1", method: "call", params: { target: "ai.complete", args: { prompt: "p", maxOutputTokens: 10 } } }).success).toBe(true);
    for (const method of ["notify", "wakeProvider", "model", "secret"]) expect(moduleCallSchema.safeParse({ id: "1", method, params: {} }).success).toBe(false);
  });
  test("event replies default result and cap it at 256 KiB serialized", () => {
    const result = "x".repeat(256 * 1024 - 2);
    expect(moduleEventReplySchema.parse({ id: "1" })).toEqual({ id: "1", result: {} });
    expect(moduleEventReplySchema.parse({ id: "1", result: { handled: true, result } })).toEqual({ id: "1", result: { handled: true, result } });
    expect(moduleEventReplySchema.safeParse({ id: "1", result: { result: `${result}x` } }).success).toBe(false);
    expect(moduleEventReplySchema.safeParse({ id: "1", result: { result: "界".repeat(90_000) } }).success).toBe(false);
  });
  test.each([
    { method: "call", params: { target: "notify.send", mode: "async" } }, { method: "call", params: { target: "bad" } },
    { method: "call", params: { target: "notify.send", extra: true } }, { method: "call", params: { target: "notify.send" }, extra: true },
    { method: "network", params: { key: "net" } },
  ])("rejects invalid call %j", call => {
    expect(moduleCallSchema.safeParse({ id: "1", ...call }).success).toBe(false);
  });
  test("deprecated effects and secrets stand for system interfaces", () => {
    expect(grantedUses({ effects: ["model", "wake_provider", "notify_user", "network"], uses: ["files.read"], secrets: ["qq_bot"] }).sort()).toEqual(["ai.complete", "ai.wake", "files.read", "notify.send", "secrets.get"]);
  });
});

test("public schedule creation accepts only wake/remind and no command; stored module schedules remain readable", () => {
  const input = { rule: { kind: "every", minutes: 5 }, text: "Check", label: "Check" };
  for (const mode of ["wake", "remind", "module"]) {
    const allowed = mode === "wake" || mode === "remind";
    expect(createScheduleSchema.safeParse({ ...input, mode }).success).toBe(allowed);
    expect(chronaToolInputSchemas.chrona_schedule.safeParse({ ...input, mode }).success).toBe(allowed);
    expect(createScheduleSchema.safeParse({ ...input, mode, command: "echo test" }).success).toBe(false);
    expect(chronaToolInputSchemas.chrona_schedule.safeParse({ ...input, mode, command: "echo test" }).success).toBe(false);
  }
  expect(scheduleSchema.safeParse({ ...input, id: "module-schedule", originSessionId: null, moduleId: null, mode: "module", until: null, status: "paused", nextAt: null, lastAt: null, lastResult: null, createdBy: "chrona", createdAt: "2026-10-20T00:00:00Z" }).success).toBe(true);
});

test("module activation defaults to ask with its policy label", () => {
  expect(DEFAULT_POLICY.activate_module).toBe("ask");
  expect(decidePolicy("activate_module", {}, [], new Date())).toMatchObject({ mode: "ask", reason: "内置规则：启用模块需要先问你" });
});
