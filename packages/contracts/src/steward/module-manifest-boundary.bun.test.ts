import { expect, test } from "bun:test";
import { moduleManifestSchema } from "./index";

const current = { name: "sample-app", entry: "index.ts", tests: ["test.ts"], keepAlive: true, effects: ["network"], uses: ["notify.send"] };

test("current manifests preserve explicit uses without inferring authority from retired fields", () => {
  expect(moduleManifestSchema.parse(current).uses).toEqual(["notify.send"]);
  for (const field of [{ channel: "web" }, { dynamicSchedules: true }, { triggers: [] }, { triggers: [{ id: "daily", schedule: { kind: "daily", time: "08:00" } }] }, { settings: {} }, { healthCheck: false }, { healthCheck: true }, { contributes: { events: { emits: [{ name: "updated" }] } } }]) {
    const parsed = moduleManifestSchema.safeParse({ ...current, ...field });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toContainEqual(expect.objectContaining({ code: "unrecognized_keys", keys: Object.keys(field) }));
  }
  for (const effect of ["model", "wake_provider", "notify_user"]) {
    expect(moduleManifestSchema.safeParse({ ...current, effects: [effect] }).success).toBe(false);
  }
});
