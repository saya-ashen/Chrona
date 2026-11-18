import { storeVersionMaterial } from "../modules/module-artifacts";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { StewardPorts } from "../ports";
import { testModuleProcess } from "./module-test-process";

/** An ordinary approved target for routing tests; notification policy belongs to Notify's own tests. */
export async function installNotifyTarget(ports: StewardPorts, workspaceId: string, mockDelivery = false) {
  const manifest = moduleManifestSchema.parse({ name: "notify", entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "send", description: "Synthetic delivery target", visibility: ["modules"], parameters: { type: "object", properties: Object.fromEntries(["key", "level", "title", "body"].map(name => [name, { type: "string" }])) }, output: {} }] });
  const files = [
    { path: "module.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    { path: "index.ts", bytes: Buffer.from(`import { on } from 'chrona';
on('tool', event => ({ result: { id: event.args.key, status: 'queued', duplicate: false } }));
`) },
    { path: "test.ts", bytes: Buffer.from("process.exit(0)") },
  ];
  files.push({ path: "chrona-material.json", bytes: Buffer.from(JSON.stringify({ schema: 1, source: files.map(file => file.path), artifacts: [], build: { commands: [], toolchain: "fixture", target: "host" } })) });
  const hash = await storeVersionMaterial(join(ports.dataDir, "platform"), files);
  const module = await ports.db.module.create({ data: { workspaceId, name: "notify", status: "active", activeHash: hash } });
  await ports.db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source: "user", status: "approved", intent: {}, report: {} } });
  const codeDir = join(ports.dataDir, "platform/store", hash);
  if (mockDelivery) {
    // Use a separate peer so background delivery cannot re-enter the caller's test handler.
    const peer = testModuleProcess(async event => {
      if (event.trigger.kind !== "tool") throw new Error("Expected notification tool event");
      return { result: { id: event.trigger.args.key, status: "queued", duplicate: false } };
    });
    const start = ports.sandbox!.startModule!;
    ports.sandbox!.startModule = input => input.codeDir === codeDir ? peer.startModule(input) : start(input);
  }
  return module;
}
