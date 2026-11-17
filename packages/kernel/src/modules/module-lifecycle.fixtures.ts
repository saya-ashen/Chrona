import { moduleManifestSchema, moduleInstallRequestSchema, moduleInstallResultSchema } from "@chrona/contracts/steward";
import { moduleIdentity, moduleCapabilities } from "./module-identity";

/** Synthetic only: no credentials, accounts, network clients or real execution resources. */
const manifest = (name: string) => moduleManifestSchema.parse({ name, description: `Fixture ${name}`, entry: "index.ts", keepAlive: true, effects: [], tests: ["test.ts"], tools: [] });
export const moduleLifecycleFixtures = {
  pi: { row: { id: "fixture-pi", name: "pi", status: "active", activeHash: "a".repeat(64) }, manifest: manifest("pi"), ...moduleIdentity({ name: "pi" }) },
  external: { row: { id: "fixture-alpha", name: "alpha", status: "active", activeHash: "b".repeat(64) }, manifest: manifest("alpha"), ...moduleIdentity({ name: "alpha" }) },
  secondExternal: { row: { id: "fixture-beta", name: "beta", status: "paused", activeHash: "c".repeat(64) }, manifest: manifest("beta") },
  reinstalled: { row: { id: "fixture-alpha-new", name: "alpha", status: "active", activeHash: "d".repeat(64) }, manifest: manifest("alpha") },
  kernel: { name: "agent", origin: "kernel" as const, capabilities: moduleCapabilities("kernel") },
  preinstalled: manifest("qq"), optional: manifest("mcp"),
  forgedManifest: { ...manifest("alpha"), builtin: true, origin: "builtin" },
  forgedRow: { id: "fixture-forged", name: "agent", status: "active", activeHash: "e".repeat(64) },
  install: moduleInstallRequestSchema.parse({ package: "qq", mode: "install", requestKey: "fixture-install-qq" }),
  failedInstall: moduleInstallResultSchema.parse({ package: "qq", requestKey: "fixture-install-qq", status: "failed", moduleId: null, hash: null, approvalId: null, error: { code: "failed", reason: "dependency_unavailable", message: "Synthetic missing dependency" } }),
  unknownInstall: moduleInstallResultSchema.parse({ package: "custom-unknown", requestKey: "fixture-unknown", status: "pending", moduleId: null, hash: null, approvalId: null, error: null }),
  callbackBefore: { moduleId: "fixture-alpha", hash: "b".repeat(64), target: "alpha.receive", input: { type: "object", properties: { value: { type: "string" } }, required: ["value"] }, output: { type: "string" }, visibility: ["modules"] },
  callbackChanged: { moduleId: "fixture-alpha", hash: "d".repeat(64), target: "alpha.receive", input: { type: "object", properties: { count: { type: "number" } }, required: ["count"] }, output: { type: "number" }, visibility: ["owner"] },
};
