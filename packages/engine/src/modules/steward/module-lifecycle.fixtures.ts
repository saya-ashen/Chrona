import { moduleManifestSchema, moduleInstallRequestSchema, moduleInstallResultSchema, type ModuleInitializationState } from "@chrona/contracts/steward";
import { moduleIdentity, moduleCapabilities } from "./module-identity";

/** Synthetic only: no credentials, accounts, network clients or real execution resources. */
const manifest = (name: string) => moduleManifestSchema.parse({ name, description: `Fixture ${name}`, entry: "index.ts", keepAlive: true, triggers: [], effects: [], tests: ["test.ts"], tools: [] });
export const moduleLifecycleFixtures = {
  builtin: { row: { id: "fixture-web", name: "web", builtin: true, status: "active", activeHash: "a".repeat(64) }, manifest: manifest("web"), ...moduleIdentity({ name: "web", builtin: true }) },
  external: { row: { id: "fixture-alpha", name: "alpha", builtin: false, status: "active", activeHash: "b".repeat(64) }, manifest: manifest("alpha"), ...moduleIdentity({ name: "alpha", builtin: false }) },
  secondExternal: { row: { id: "fixture-beta", name: "beta", builtin: false, status: "paused", activeHash: "c".repeat(64) }, manifest: manifest("beta") },
  reinstalled: { row: { id: "fixture-alpha-new", name: "alpha", builtin: false, status: "active", activeHash: "d".repeat(64) }, manifest: manifest("alpha") },
  kernel: { name: "modules", origin: "kernel" as const, capabilities: moduleCapabilities("kernel") },
  preinstalled: manifest("qq"), optional: manifest("memory-local"),
  forgedManifest: { ...manifest("alpha"), builtin: true, origin: "builtin" },
  forgedRow: { id: "fixture-forged", name: "web", builtin: false, status: "active", activeHash: "e".repeat(64) },
  install: moduleInstallRequestSchema.parse({ package: "qq", mode: "install", requestKey: "fixture-install-qq" }),
  failedInstall: moduleInstallResultSchema.parse({ package: "qq", requestKey: "fixture-install-qq", status: "failed", moduleId: null, hash: null, approvalId: null, error: { code: "failed", reason: "dependency_unavailable", message: "Synthetic missing dependency" } }),
  unknownInstall: moduleInstallResultSchema.parse({ package: "remind", requestKey: "fixture-unknown", status: "pending", moduleId: null, hash: null, approvalId: null, error: null }),
  callbackBefore: { moduleId: "fixture-alpha", hash: "b".repeat(64), target: "alpha.receive", input: { type: "object", properties: { value: { type: "string" } }, required: ["value"] }, output: { type: "string" }, visibility: ["modules"] },
  callbackChanged: { moduleId: "fixture-alpha", hash: "d".repeat(64), target: "alpha.receive", input: { type: "object", properties: { count: { type: "number" } }, required: ["count"] }, output: { type: "number" }, visibility: ["owner"] },
};
export function completedInitializationFixture(): ModuleInitializationState {
  return { version: 1, status: "complete", packages: Object.fromEntries(["qq", "remind", "mind"].map(name => [name, { requestKey: `initialize:v1:${name}:1`, attempts: 1, status: "installed", moduleId: `fixture-${name}`, hash: "a".repeat(64), approvalId: null, error: null }])) as ModuleInitializationState["packages"] };
}
