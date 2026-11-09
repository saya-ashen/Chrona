import { expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { runOfflineChecks } from "./offline";
import { buildManifest } from "./manifest";
import manifest from "./module.json";

test("Mind persistence, caller trust, source matching, feedback and restart boundaries offline", async () => {
  expect(await runOfflineChecks()).toBeGreaterThanOrEqual(12);
}, 30_000);

test("published manifest matches local schemas and the current real contract", () => {
  expect(manifest as unknown).toEqual(buildManifest());
  expect(moduleManifestSchema.parse(manifest).name).toBe("mind");
});
